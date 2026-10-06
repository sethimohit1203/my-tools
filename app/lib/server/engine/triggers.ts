// Event triggers, scheduled triggers and the n8n ticker.
import { db } from "../db";
import { sha256 } from "../crypto";
import { readRows } from "../google";
import type { Rule } from "../../automation/types";
import { evalRules, type Ctx } from "./template";
import { dispatchRun } from "./runs";
import { nextRunAt, type ScheduleSpec } from "./schedule";
import { getWorkflow, startWorkflowRun, type WorkflowRow } from "./workflows";

const fakeCtx = (record: Record<string, unknown>): Ctx => ({ record, steps: {}, vars: {}, run: { id: "", is_test: false }, now: new Date().toISOString(), today: new Date().toISOString().slice(0, 10) });

/** Fire workflows listening for an event (new_lead, monitor_event, campaign_event). */
export async function emitEvent(ws: string, type: "new_lead" | "monitor_event" | "campaign_event", payload: Record<string, unknown>) {
  const rows = await db()`select * from automation_workflows where workspace_id = ${ws} and status = 'active' and trigger_type = ${type}`;
  const started: string[] = [];
  for (const w of rows as unknown as WorkflowRow[]) {
    const cfg = (w.definition?.trigger?.config || {}) as Record<string, unknown>;
    if ((type === "monitor_event" || type === "campaign_event") && cfg.event && cfg.event !== "any" && cfg.event !== payload.event) continue;
    if (cfg.filter && !evalRules(cfg.filter as Rule[], "and", fakeCtx(payload)).pass) continue;
    try {
      const key = payload.event_id ? `${type}:${w.id}:${payload.event_id}` : undefined;
      const r = await startWorkflowRun(ws, w, { trigger: type, records: [payload], idempotencyKey: key });
      started.push(r.run_id);
    } catch (e) { console.error("[emitEvent]", w.id, e); }
  }
  return started;
}

/** Called by a per-workflow n8n cron, or by the ticker for schedules without one. */
export async function fireSchedule(scheduleId: string, firedAt = new Date()) {
  const sql = db();
  const [s] = await sql`select * from automation_schedules where id = ${scheduleId}`;
  if (!s || s.status !== "active") return { skipped: "schedule inactive" };
  const wf = await getWorkflow(String(s.workspace_id), String(s.workflow_id));
  if (wf.status !== "active") return { skipped: `workflow ${wf.status}` };
  const slot = new Date(Math.floor(firedAt.getTime() / 60000) * 60000).toISOString(); // dedupe double fires in the same minute
  const cfg = wf.definition.trigger.config as Record<string, unknown>;
  const r = await startWorkflowRun(String(s.workspace_id), wf, { trigger: "schedule", records: cfg.input || [{}], idempotencyKey: `sched:${scheduleId}:${slot}` });
  const next = s.kind === "once" ? null : nextRunAt(s as unknown as ScheduleSpec, firedAt);
  await sql`update automation_schedules set last_run_at = now(), last_run_id = ${r.run_id}, next_run_at = ${next}, status = ${next ? "active" : "paused"}, updated_at = now() where id = ${scheduleId}`;
  return r;
}

async function dueSchedules() {
  const due = await db()`select id, next_run_at from automation_schedules where status = 'active' and n8n_workflow_id is null and next_run_at <= now() limit 50`;
  let n = 0;
  for (const s of due) { try { await fireSchedule(String(s.id), new Date(s.next_run_at as string)); n++; } catch (e) { console.error("[tick schedule]", e); } }
  return n;
}

/** Google Sheets new/updated row triggers (polling with row hashes). */
export async function scanSheetTrigger(wf: WorkflowRow, opts: { force?: boolean } = {}) {
  const sql = db();
  const ws = wf.workspace_id;
  const cfg = wf.definition.trigger.config as Record<string, string | Rule[]>;
  const spreadsheet = String(cfg.spreadsheet_id), sheet = String(cfg.sheet), keyCol = String(cfg.key_column || "");
  const [cur] = await sql`select last_scan_at from sheet_trigger_cursors where workflow_id = ${wf.id}`;
  if (!opts.force && cur?.last_scan_at && Date.now() - new Date(cur.last_scan_at as string).getTime() < 4 * 60000) return { skipped: "scanned recently" };
  try {
    const { rows } = await readRows(ws, spreadsheet, sheet);
    const baseline = !cur?.last_scan_at;
    const states = await sql`select row_key, row_hash from sheet_row_state where workflow_id = ${wf.id} and spreadsheet_id = ${spreadsheet} and sheet_name = ${sheet}`;
    const known = new Map(states.map((r) => [String(r.row_key), String(r.row_hash)]));
    const picked: { key: string; hash: string; row: Record<string, string> }[] = [];
    for (const row of rows) {
      const key = keyCol ? String(row[keyCol] || "") : row._row;
      if (!key) continue;
      const { _row, ...vals } = row; void _row;
      const hash = sha256(JSON.stringify(vals));
      const prev = known.get(key);
      const isNew = prev === undefined, changed = prev !== undefined && prev !== hash;
      if (baseline) { picked.push({ key, hash, row }); continue; }
      if (wf.trigger_type === "sheets_new_row" ? isNew : changed) {
        if (cfg.filter && !evalRules(cfg.filter as Rule[], "and", fakeCtx(row)).pass) continue;
        picked.push({ key, hash, row });
      }
    }
    if (baseline) {
      for (let i = 0; i < picked.length; i += 500) {
        const chunk = picked.slice(i, i + 500).map((p) => ({ workflow_id: wf.id, spreadsheet_id: spreadsheet, sheet_name: sheet, row_key: p.key, row_hash: p.hash, status: "baseline" }));
        if (chunk.length) await sql`insert into sheet_row_state ${sql(chunk as never)} on conflict do nothing`;
      }
      await sql`insert into sheet_trigger_cursors (workflow_id, last_scan_at, last_error) values (${wf.id}, now(), null) on conflict (workflow_id) do update set last_scan_at = now(), last_error = null`;
      return { baseline: picked.length };
    }
    // Claim rows atomically so concurrent ticks can't process the same row twice.
    const claimed: typeof picked = [];
    for (const p of picked) {
      const [r] = wf.trigger_type === "sheets_new_row"
        ? await sql`insert into sheet_row_state (workflow_id, spreadsheet_id, sheet_name, row_key, row_hash, status) values (${wf.id}, ${spreadsheet}, ${sheet}, ${p.key}, ${p.hash}, 'queued') on conflict do nothing returning row_key`
        : await sql`update sheet_row_state set row_hash = ${p.hash}, status = 'queued', updated_at = now() where workflow_id = ${wf.id} and spreadsheet_id = ${spreadsheet} and sheet_name = ${sheet} and row_key = ${p.key} and row_hash <> ${p.hash} returning row_key`;
      if (r) claimed.push(p);
    }
    await sql`insert into sheet_trigger_cursors (workflow_id, last_scan_at, last_error) values (${wf.id}, now(), null) on conflict (workflow_id) do update set last_scan_at = now(), last_error = null`;
    if (!claimed.length) return { new_rows: 0 };
    const r = await startWorkflowRun(ws, wf, { trigger: wf.trigger_type, records: claimed.map((p) => ({ ...p.row, row_key: p.key, spreadsheet_id: spreadsheet, sheet })), itemKeys: claimed.map((p) => p.key) });
    await sql`update sheet_row_state set run_id = ${r.run_id} where workflow_id = ${wf.id} and row_key in ${sql(claimed.map((p) => p.key))}`;
    return { new_rows: claimed.length, run_id: r.run_id };
  } catch (e) {
    await sql`insert into sheet_trigger_cursors (workflow_id, last_scan_at, last_error) values (${wf.id}, now(), ${(e as Error).message}) on conflict (workflow_id) do update set last_scan_at = now(), last_error = excluded.last_error`;
    throw e;
  }
}

async function sheetTriggers() {
  const wfs = await db()`select * from automation_workflows where status = 'active' and trigger_type in ('sheets_new_row','sheets_updated_row')`;
  let runs = 0;
  for (const w of wfs) { try { const r = await scanSheetTrigger(w as unknown as WorkflowRow); if ((r as { run_id?: string }).run_id) runs++; } catch (e) { console.error("[tick sheets]", w.id, (e as Error).message); } }
  return runs;
}

/** Runs that never reached n8n, or whose n8n execution died, get re-dispatched. */
async function redispatchStale() {
  const sql = db();
  const rows = await sql`select r.id, r.workspace_id from automation_runs r
    where r.is_test = false and (
      (r.status = 'queued' and r.created_at < now() - interval '2 minutes' and (r.dispatched_at is null or r.dispatched_at < now() - interval '10 minutes'))
      or (r.status = 'running' and r.updated_at < now() - interval '15 minutes' and exists (select 1 from automation_run_items i where i.run_id = r.id and i.status in ('pending','waiting') and i.next_attempt_at <= now()))
    ) limit 25`;
  for (const r of rows) await dispatchRun(String(r.workspace_id), String(r.id)).catch(() => null);
  return rows.length;
}

/** Ticker entry point (n8n schedule, every 5 minutes). Each part is isolated. */
export async function tick() {
  const out: Record<string, unknown> = { at: new Date().toISOString() };
  const part = async (name: string, f: () => Promise<unknown>) => { try { out[name] = await f(); } catch (e) { out[name] = { error: (e as Error).message }; } };
  const { campaignTick } = await import("../campaigns");
  const { monitorTick } = await import("../monitors");
  const { socialTick } = await import("../social-posts");
  const { replyCheckTick } = await import("../campaigns");
  await part("schedules", dueSchedules);
  await part("sheets", sheetTriggers);
  await part("campaigns", campaignTick);
  await part("replies", replyCheckTick);
  await part("monitors", monitorTick);
  await part("social", socialTick);
  await part("redispatched", redispatchStale);
  await part("cleanup", async () => { await db()`delete from rate_limit_counters where window_start < now() - interval '1 day'`; return true; });
  return out;
}

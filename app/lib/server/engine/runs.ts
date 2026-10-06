// Run lifecycle: create → dispatch to n8n → step (claim + execute items with
// leases, retries with exponential backoff) → finalize. Shared by every
// automation (workflows, campaigns, monitors, social, reports, AI processor).
import { db, HttpError } from "../db";
import { ActionError, toActionError } from "../errors";
import { getIntegration } from "../integrations";
import { notify } from "../notify";
import type { Definition } from "../../automation/types";
import type { Ctx } from "./template";

export type RunKind = "workflow" | "ai_processor" | "campaign" | "monitor" | "social" | "report";
export type RunRow = { id: string; workspace_id: string; workflow_id: string | null; workflow_version: number | null; workflow_name: string | null; kind: RunKind; trigger: string; status: string; is_test: boolean; input: Record<string, unknown> | null; records_total: number; started_at: string | null; created_at: string; retry_count: number };
export type ItemRow = { id: string; run_id: string; workspace_id: string; seq: number; item_key: string | null; input: Record<string, unknown>; context: Record<string, unknown>; status: string; current_step: number; attempts: number; max_attempts: number };

const BACKOFF_BASE_SEC = Number(process.env.ENGINE_BACKOFF_BASE_SEC || 30);
const LEASE_SEC = 180;

export async function log(ws: string, runId: string | null, message: string, o: { level?: "info" | "warn" | "error" | "debug"; itemId?: string | null; service?: string; step?: string; data?: unknown } = {}) {
  await db()`insert into execution_logs (workspace_id, run_id, item_id, level, service, step, message, data)
    values (${ws}, ${runId}, ${o.itemId ?? null}, ${o.level || "info"}, ${o.service ?? null}, ${o.step ?? null}, ${message}, ${o.data === undefined ? null : db().json(o.data as never)})`;
}

export type CreateRunInput = {
  ws: string; kind?: RunKind; workflowId?: string | null; workflowVersion?: number | null; workflowName?: string | null;
  trigger: string; records: Record<string, unknown>[]; input?: Record<string, unknown>; isTest?: boolean; createdBy?: string | null;
  idempotencyKey?: string | null; parentRunId?: string | null; itemKeys?: (string | null)[]; maxAttempts?: number;
  itemState?: { context?: Record<string, unknown>; current_step?: number }[];
};

export async function createRun(o: CreateRunInput): Promise<{ id: string; duplicate: boolean }> {
  const sql = db();
  if (o.idempotencyKey) {
    const [ex] = await sql`select id from automation_runs where workspace_id = ${o.ws} and idempotency_key = ${o.idempotencyKey}`;
    if (ex) return { id: String(ex.id), duplicate: true };
  }
  const maxAttempts = o.maxAttempts ?? 3;
  const id = await sql.begin(async (tx) => {
    const [run] = await tx`insert into automation_runs (workspace_id, workflow_id, workflow_version, workflow_name, kind, trigger, status, is_test, input, records_total, created_by, idempotency_key, parent_run_id)
      values (${o.ws}, ${o.workflowId ?? null}, ${o.workflowVersion ?? null}, ${o.workflowName ?? null}, ${o.kind || "workflow"}, ${o.trigger}, 'queued', ${!!o.isTest}, ${tx.json((o.input || {}) as never)}, ${o.records.length}, ${o.createdBy ?? null}, ${o.idempotencyKey ?? null}, ${o.parentRunId ?? null})
      returning id`;
    const rows = o.records.map((r, i) => ({
      run_id: run.id, workspace_id: o.ws, seq: i + 1, item_key: o.itemKeys?.[i] ?? null, input: r,
      context: o.itemState?.[i]?.context || {}, current_step: o.itemState?.[i]?.current_step || 0, max_attempts: maxAttempts,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await tx`insert into automation_run_items ${tx(chunk.map((r) => ({ ...r, input: tx.json(r.input as never), context: tx.json(r.context as never) })) as never, "run_id", "workspace_id", "seq", "item_key", "input", "context", "current_step", "max_attempts")}`;
    }
    if (o.workflowId) await tx`update automation_workflows set last_run_at = now() where id = ${o.workflowId}`;
    return String(run.id);
  });
  await log(o.ws, id, `Triggered (${o.trigger}${o.isTest ? ", test mode" : ""})`);
  await log(o.ws, id, `Loaded ${o.records.length} record${o.records.length === 1 ? "" : "s"}`);
  return { id, duplicate: false };
}

/** Hand the run to n8n's Run Processor. Never pretends: if n8n isn't set up the run stays queued with the reason. */
export async function dispatchRun(ws: string, runId: string): Promise<{ dispatched: boolean; error?: string }> {
  const sql = db();
  const n8n = await getIntegration(ws, "n8n");
  const url = n8n?.config.run_webhook_url;
  if (!n8n || n8n.status !== "connected" || !url) {
    const error = "Integration Required: n8n is not configured — the run is queued and will start once n8n is connected (Settings → Integrations → n8n).";
    await sql`update automation_runs set dispatch_error = ${error}, updated_at = now() where id = ${runId}`;
    await log(ws, runId, error, { level: "warn", service: "n8n" });
    return { dispatched: false, error };
  }
  try {
    const { externalUrl } = await import("../errors");
    const res = await fetch(externalUrl(url), { method: "POST", headers: { "Content-Type": "application/json", ...(n8n.secrets.webhook_token ? { "x-mytools-token": n8n.secrets.webhook_token } : {}) }, body: JSON.stringify({ run_id: runId }), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`n8n webhook returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await sql`update automation_runs set dispatched_at = now(), dispatch_error = null, updated_at = now() where id = ${runId}`;
    await log(ws, runId, "Sent to n8n Run Processor", { service: "n8n" });
    return { dispatched: true };
  } catch (e) {
    const error = `Could not reach n8n: ${(e as Error).message}`;
    await sql`update automation_runs set dispatch_error = ${error}, updated_at = now() where id = ${runId}`;
    await log(ws, runId, error, { level: "error", service: "n8n" });
    return { dispatched: false, error };
  }
}

async function loadRun(runId: string): Promise<RunRow> {
  const [r] = await db()`select * from automation_runs where id = ${runId}`;
  if (!r) throw new HttpError(404, "Run not found");
  return r as unknown as RunRow;
}

/** Claim one due item (or one whose lease expired) with SKIP LOCKED. */
async function claim(runId: string): Promise<ItemRow | null> {
  const [it] = await db()`
    update automation_run_items set status = 'processing', lease_until = now() + make_interval(secs => ${LEASE_SEC}), started_at = coalesce(started_at, now()), updated_at = now()
    where id = (
      select id from automation_run_items
      where run_id = ${runId} and ((status in ('pending','waiting') and next_attempt_at <= now()) or (status = 'processing' and lease_until < now()))
      order by seq limit 1 for update skip locked
    ) returning *`;
  return (it as unknown as ItemRow) || null;
}

export type StepResult = { action: "continue" | "wait" | "done" | "paused"; wait_seconds?: number; status: string; processed: number; counts: Counts };
type Counts = { total: number; success: number; failed: number; skipped: number; pending: number; processing: number; waiting: number; cancelled: number };

export async function counts(runId: string): Promise<Counts> {
  const rows = await db()`select status, count(*)::int as n from automation_run_items where run_id = ${runId} group by status`;
  const m = Object.fromEntries(rows.map((r) => [String(r.status), Number(r.n)]));
  const c = { success: m.success || 0, failed: m.failed || 0, skipped: m.skipped || 0, pending: m.pending || 0, processing: m.processing || 0, waiting: m.waiting || 0, cancelled: m.cancelled || 0, total: 0 };
  c.total = Object.values(m).reduce((a, b) => a + Number(b), 0);
  return c;
}

/** One bounded slice of work, called repeatedly by n8n until "done". */
export async function stepRun(runId: string, budgetMs = 40000): Promise<StepResult> {
  const started = Date.now();
  const sql = db();
  let run = await loadRun(runId);
  if (["completed", "partially_completed", "failed", "cancelled"].includes(run.status)) return { action: "done", status: run.status, processed: 0, counts: await counts(runId) };
  if (run.workflow_id) {
    const [wf] = await sql`select status from automation_workflows where id = ${run.workflow_id}`;
    if (wf?.status === "paused" && !run.is_test) {
      if (run.status !== "paused") { await sql`update automation_runs set status = 'paused', updated_at = now() where id = ${runId}`; await log(run.workspace_id, runId, "Paused (workflow paused)", { level: "warn" }); }
      return { action: "paused", status: "paused", processed: 0, counts: await counts(runId) };
    }
  }
  if (run.status === "paused") return { action: "paused", status: "paused", processed: 0, counts: await counts(runId) };
  if (run.status === "queued") {
    await sql`update automation_runs set status = 'running', started_at = coalesce(started_at, now()), updated_at = now() where id = ${runId}`;
    const c = await counts(runId);
    await log(run.workspace_id, runId, `Processing ${c.pending} record${c.pending === 1 ? "" : "s"}`);
    run = await loadRun(runId);
  }
  const ratePerMin = Number((run.input?.ratePerMinute as number) || 0);
  let processed = 0, throttled = false;
  const { hitRateLimit } = await import("../ratelimit");
  while (Date.now() - started < budgetMs) {
    // Per-run (per-workflow) rate limit, shared across concurrent n8n executions.
    if (ratePerMin && !(await hitRateLimit(`run:${runId}`, 60, ratePerMin))) { throttled = true; break; }
    const fresh = await sql`select status from automation_runs where id = ${runId}`;
    if (fresh[0]?.status === "cancelled") break;
    const item = await claim(runId);
    if (!item) break;
    await executeItem(run, item);
    processed++;
  }
  const c = await counts(runId);
  await sql`update automation_runs set records_total = ${c.total}, records_success = ${c.success}, records_failed = ${c.failed}, records_skipped = ${c.skipped + c.cancelled}, updated_at = now() where id = ${runId}`;
  const [now] = await sql`select status from automation_runs where id = ${runId}`;
  if (now?.status === "cancelled") return { action: "done", status: "cancelled", processed, counts: c };
  if (c.pending + c.processing + c.waiting === 0) {
    const status = await finalizeRun(runId);
    return { action: "done", status, processed, counts: c };
  }
  const [next] = await sql`select extract(epoch from (min(next_attempt_at) - now()))::float as secs from automation_run_items where run_id = ${runId} and status in ('pending','waiting')`;
  const secs = Number(next?.secs ?? 0);
  if (throttled) return { action: "wait", wait_seconds: 61 - (Math.floor(Date.now() / 1000) % 60), status: "running", processed, counts: c };
  if (c.processing > 0 && c.pending + c.waiting === 0) return { action: "wait", wait_seconds: 15, status: "running", processed, counts: c };
  if (secs > 1) return { action: "wait", wait_seconds: Math.min(Math.ceil(secs), 3600), status: "running", processed, counts: c };
  return { action: "continue", status: "running", processed, counts: c };
}

export async function finalizeRun(runId: string): Promise<string> {
  const sql = db();
  const run = await loadRun(runId);
  if (["completed", "partially_completed", "failed", "cancelled"].includes(run.status)) return run.status;
  const c = await counts(runId);
  const status = c.total === 0 ? "completed" : c.failed === 0 ? "completed" : c.success + c.skipped > 0 ? "partially_completed" : "failed";
  const [r] = await sql`update automation_runs set status = ${status}, completed_at = now(), records_total = ${c.total}, records_success = ${c.success}, records_failed = ${c.failed}, records_skipped = ${c.skipped + c.cancelled},
      duration_ms = (extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::int, updated_at = now()
    where id = ${runId} and status not in ('completed','partially_completed','failed','cancelled') returning id`;
  if (!r) return (await loadRun(runId)).status;
  await log(run.workspace_id, runId, `${c.success} successful, ${c.failed} failed, ${c.skipped} skipped`);
  await log(run.workspace_id, runId, status === "completed" ? "Completed" : status === "failed" ? "Failed" : "Partially completed", { level: status === "completed" ? "info" : status === "failed" ? "error" : "warn" });
  if (!run.is_test) {
    const name = run.workflow_name || run.kind;
    if (status === "failed") await notify(run.workspace_id, { type: "workflow_failed", severity: "error", title: `${name} failed`, body: `${c.failed} of ${c.total} records failed.`, link: `/automation/runs/${runId}`, email: true });
    else if (status === "partially_completed") await notify(run.workspace_id, { type: "workflow_partial", severity: "warning", title: `${name} finished with ${c.failed} failures`, body: `${c.success} succeeded, ${c.failed} failed.`, link: `/automation/runs/${runId}` });
    else if (c.total > 1) await notify(run.workspace_id, { type: "bulk_finished", severity: "success", title: `${name} completed`, body: `${c.success} records processed.`, link: `/automation/runs/${runId}` });
  }
  return status;
}

// ── Item execution ─────────────────────────────────────────────────────
export type ExecEnv = { ws: string; run: RunRow; item: ItemRow; testMode: boolean; confirmLive: boolean };
type KindHandler = (env: ExecEnv) => Promise<unknown>;
const kindHandlers: Partial<Record<RunKind, KindHandler>> = {};
export function registerKind(kind: RunKind, h: KindHandler) { kindHandlers[kind] = h; }

async function definitionFor(run: RunRow): Promise<Definition> {
  if (run.input?.definition) return run.input.definition as Definition;
  if (!run.workflow_id) throw new Error("Run has no workflow definition");
  const [v] = await db()`select definition from automation_workflow_versions where workflow_id = ${run.workflow_id} and version = ${run.workflow_version ?? 0}`;
  if (v) return v.definition as Definition;
  const [wf] = await db()`select definition from automation_workflows where id = ${run.workflow_id}`;
  if (!wf) throw new Error("Workflow was deleted");
  return wf.definition as Definition;
}

export function backoffSeconds(attempt: number, retryAfter?: number) {
  if (retryAfter) return retryAfter;
  return Math.min(BACKOFF_BASE_SEC * 2 ** Math.max(0, attempt - 1), 3600); // 30s, 60s, 120s…
}

export async function executeItem(run: RunRow, item: ItemRow): Promise<void> {
  const env: ExecEnv = { ws: run.workspace_id, run, item, testMode: run.is_test, confirmLive: !!run.input?.confirm_live };
  const handler = kindHandlers[run.kind];
  if (handler) return executeKindItem(env, handler);
  const def = await definitionFor(run);
  const { runAction } = await import("./actions");
  const ctxState = (item.context || {}) as { record?: Record<string, unknown>; steps?: Record<string, unknown>; vars?: Record<string, unknown> };
  const now = new Date();
  const ctx: Ctx = {
    record: ctxState.record || { ...item.input }, steps: ctxState.steps || {}, vars: ctxState.vars || {},
    run: { id: run.id, is_test: run.is_test }, now: now.toISOString(), today: now.toISOString().slice(0, 10),
  };
  const sql = db();
  const steps = def.steps || [];
  let i = item.current_step;
  let skipNext = false;
  while (i < steps.length) {
    const node = steps[i];
    if (skipNext) {
      skipNext = false;
      await sql`insert into automation_step_runs (run_id, item_id, workspace_id, node_key, step_index, step_type, status, attempt, completed_at, duration_ms) values (${run.id}, ${item.id}, ${run.workspace_id}, ${node.key}, ${i}, ${node.type}, 'skipped', ${item.attempts + 1}, now(), 0)`;
      i++; continue;
    }
    const t0 = Date.now();
    try {
      const out = await runAction(node, ctx, env);
      const control = (out as { __control?: string; __delay?: number; __loop?: unknown[]; __dryRun?: unknown; __skipItem?: string }) || {};
      const visible = control.__dryRun !== undefined ? control.__dryRun : out;
      await sql`insert into automation_step_runs (run_id, item_id, workspace_id, node_key, step_index, step_type, service, status, attempt, input, output, completed_at, duration_ms)
        values (${run.id}, ${item.id}, ${run.workspace_id}, ${node.key}, ${i}, ${node.type}, ${node.type}, ${control.__dryRun !== undefined ? "dry_run" : "success"}, ${item.attempts + 1}, ${sql.json(redactConfig(node.config) as never)}, ${sql.json(trimOut(visible) as never)}, now(), ${Date.now() - t0})`;
      ctx.steps[node.key] = control.__dryRun !== undefined ? control.__dryRun : out;
      i++;
      if (control.__skipItem) {
        await sql`update automation_run_items set status = 'skipped', output = ${sql.json({ reason: control.__skipItem } as never)}, context = ${sql.json(stateOf(ctx) as never)}, current_step = ${i}, lease_until = null, completed_at = now(), updated_at = now() where id = ${item.id}`;
        await log(run.workspace_id, run.id, `Record ${item.seq} skipped: ${control.__skipItem}`, { itemId: item.id, step: node.name });
        return;
      }
      if (control.__control === "stop") {
        await sql`update automation_run_items set status = 'skipped', output = ${sql.json({ reason: `Condition "${node.name}" not met` } as never)}, context = ${sql.json(stateOf(ctx) as never)}, current_step = ${i}, lease_until = null, completed_at = now(), updated_at = now() where id = ${item.id}`;
        return;
      }
      if (control.__control === "skip_next") skipNext = true;
      if (control.__loop) {
        const list = control.__loop as Record<string, unknown>[];
        const [mx] = await sql`select coalesce(max(seq),0)::int as m from automation_run_items where run_id = ${run.id}`;
        const children = list.map((x, k) => ({
          run_id: run.id, workspace_id: run.workspace_id, seq: Number(mx.m) + k + 1, item_key: null,
          input: sql.json({ ...ctx.record, ...(x && typeof x === "object" ? x : { value: x }), _parent_seq: item.seq } as never),
          context: sql.json({ record: { ...ctx.record, ...(x && typeof x === "object" ? x : { value: x }) }, steps: ctx.steps, vars: ctx.vars } as never),
          current_step: i, max_attempts: item.max_attempts,
        }));
        for (let k = 0; k < children.length; k += 500) await sql`insert into automation_run_items ${sql(children.slice(k, k + 500) as never, "run_id", "workspace_id", "seq", "item_key", "input", "context", "current_step", "max_attempts")}`;
        await sql`update automation_run_items set status = 'success', output = ${sql.json({ looped: list.length } as never)}, context = ${sql.json(stateOf(ctx) as never)}, current_step = ${i}, lease_until = null, completed_at = now(), updated_at = now() where id = ${item.id}`;
        await log(run.workspace_id, run.id, `Loop "${node.name}" queued ${list.length} records`, { itemId: item.id });
        return;
      }
      if (control.__delay) {
        if (env.testMode) { await log(run.workspace_id, run.id, `Test mode: skipped delay of ${control.__delay}s`, { itemId: item.id, step: node.name }); continue; }
        await sql`update automation_run_items set status = 'waiting', next_attempt_at = now() + make_interval(secs => ${control.__delay}), current_step = ${i}, context = ${sql.json(stateOf(ctx) as never)}, lease_until = null, updated_at = now() where id = ${item.id}`;
        return;
      }
      // Persist progress after every step so a retry resumes here (no repeated side effects).
      await sql`update automation_run_items set current_step = ${i}, context = ${sql.json(stateOf(ctx) as never)}, lease_until = now() + make_interval(secs => ${LEASE_SEC}), updated_at = now() where id = ${item.id}`;
    } catch (e) {
      await handleItemError(env, e, { nodeKey: node.key, stepIndex: i, stepType: node.type, stepName: node.name, t0, ctx });
      return;
    }
  }
  await sql`update automation_run_items set status = 'success', output = ${sql.json(trimOut(lastOutput(ctx, steps)) as never)}, context = ${sql.json(stateOf(ctx) as never)}, current_step = ${i}, lease_until = null, error = null, completed_at = now(), updated_at = now() where id = ${item.id}`;
}

async function executeKindItem(env: ExecEnv, handler: KindHandler) {
  const sql = db();
  const t0 = Date.now();
  try {
    const out = await handler(env);
    const skip = (out as { __skipItem?: string })?.__skipItem;
    await sql`insert into automation_step_runs (run_id, item_id, workspace_id, node_key, step_index, step_type, service, status, attempt, input, output, completed_at, duration_ms)
      values (${env.run.id}, ${env.item.id}, ${env.ws}, ${env.run.kind}, 0, ${env.run.kind}, ${env.run.kind}, ${skip ? "skipped" : (out as { __dryRun?: unknown })?.__dryRun !== undefined ? "dry_run" : "success"}, ${env.item.attempts + 1}, ${sql.json(env.item.input as never)}, ${sql.json(trimOut(out) as never)}, now(), ${Date.now() - t0})`;
    await sql`update automation_run_items set status = ${skip ? "skipped" : "success"}, output = ${sql.json(trimOut(out) as never)}, lease_until = null, error = null, completed_at = now(), updated_at = now() where id = ${env.item.id}`;
  } catch (e) {
    await handleItemError(env, e, { nodeKey: env.run.kind, stepIndex: 0, stepType: env.run.kind, stepName: env.run.kind, t0 });
  }
}

async function handleItemError(env: ExecEnv, e: unknown, s: { nodeKey: string; stepIndex: number; stepType: string; stepName: string; t0: number; ctx?: Ctx }) {
  const sql = db();
  const ae = e instanceof ActionError ? e : toActionError(e, s.stepType);
  const selfLimited = ae.code === "self_rate_limited";
  const attempt = env.item.attempts + (selfLimited ? 0 : 1);
  const willRetry = ae.retryable && (selfLimited || attempt < env.item.max_attempts);
  await sql`insert into automation_step_runs (run_id, item_id, workspace_id, node_key, step_index, step_type, service, status, attempt, input, error, http_status, provider_response, recommended_action, completed_at, duration_ms)
    values (${env.run.id}, ${env.item.id}, ${env.ws}, ${s.nodeKey}, ${s.stepIndex}, ${s.stepType}, ${ae.service}, ${willRetry ? "retrying" : "failed"}, ${attempt || 1}, ${sql.json(env.item.input as never)}, ${ae.message}, ${ae.httpStatus ?? null}, ${ae.providerResponse === undefined ? null : sql.json(trimOut(ae.providerResponse) as never)}, ${ae.recommendedAction ?? null}, now(), ${Date.now() - s.t0})`;
  const error = { service: ae.service, step: s.stepName, step_index: s.stepIndex, message: ae.message, http_status: ae.httpStatus ?? null, provider_response: trimOut(ae.providerResponse), retry_count: attempt, recommended_action: ae.recommendedAction ?? null, code: ae.code ?? null, at: new Date().toISOString(), permanent: !willRetry };
  const context = s.ctx ? sql.json(stateOf(s.ctx) as never) : sql.json(env.item.context as never);
  if (willRetry) {
    const wait = backoffSeconds(attempt, ae.retryAfterSec);
    await sql`update automation_run_items set status = 'pending', attempts = ${attempt}, next_attempt_at = now() + make_interval(secs => ${wait}), current_step = ${s.stepIndex}, context = ${context}, error = ${sql.json(error as never)}, lease_until = null, updated_at = now() where id = ${env.item.id}`;
    await log(env.ws, env.run.id, `Record ${env.item.seq}: ${ae.message} — retry ${attempt}/${env.item.max_attempts - 1} in ${wait}s`, { level: "warn", itemId: env.item.id, service: ae.service, step: s.stepName });
  } else {
    await sql`update automation_run_items set status = 'failed', attempts = ${attempt}, current_step = ${s.stepIndex}, context = ${context}, error = ${sql.json(error as never)}, lease_until = null, completed_at = now(), updated_at = now() where id = ${env.item.id}`;
    await log(env.ws, env.run.id, `Record ${env.item.seq} failed at "${s.stepName}": ${ae.message}`, { level: "error", itemId: env.item.id, service: ae.service, step: s.stepName, data: { recommended_action: ae.recommendedAction } });
  }
}

function stateOf(ctx: Ctx) { return { record: ctx.record, steps: ctx.steps, vars: ctx.vars }; }
function lastOutput(ctx: Ctx, steps: { key: string }[]) { return { record: ctx.record, last: steps.length ? ctx.steps[steps[steps.length - 1].key] : null }; }

const SECRETISH = /(password|secret|token|api_key|apikey|authorization)/i;
function redactConfig(c: Record<string, unknown>) { return Object.fromEntries(Object.entries(c || {}).map(([k, v]) => [k, SECRETISH.test(k) ? "•••" : v])); }

export function trimOut(v: unknown): unknown {
  if (v === undefined) return null;
  const s = JSON.stringify(v);
  if (s && s.length > 20000) return { truncated: true, preview: s.slice(0, 20000) };
  return v;
}

// ── Control operations ─────────────────────────────────────────────────
export async function cancelRun(ws: string, runId: string) {
  const sql = db();
  const [r] = await sql`update automation_runs set status = 'cancelled', completed_at = now(), updated_at = now(), duration_ms = (extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::int
    where id = ${runId} and workspace_id = ${ws} and status in ('queued','running','paused') returning id`;
  if (!r) throw new HttpError(409, "Run is not active");
  await sql`update automation_run_items set status = 'cancelled', lease_until = null, updated_at = now() where run_id = ${runId} and status in ('pending','waiting','processing')`;
  const c = await counts(runId);
  await sql`update automation_runs set records_success = ${c.success}, records_failed = ${c.failed}, records_skipped = ${c.skipped + c.cancelled} where id = ${runId}`;
  await log(ws, runId, "Cancelled by user", { level: "warn" });
}

/** Retry failed records (resume at failed step) or the entire run (from scratch) as a new linked run. */
export async function retryRun(ws: string, runId: string, mode: "failed" | "all", userId?: string) {
  const sql = db();
  const [run] = await sql`select * from automation_runs where id = ${runId} and workspace_id = ${ws}`;
  if (!run) throw new HttpError(404, "Run not found");
  if (["queued", "running"].includes(String(run.status))) throw new HttpError(409, "Run is still active");
  const items = mode === "failed"
    ? await sql`select input, item_key, context, current_step from automation_run_items where run_id = ${runId} and status = 'failed' order by seq`
    : await sql`select input, item_key from automation_run_items where run_id = ${runId} and (input->>'_parent_seq') is null order by seq`;
  if (!items.length) throw new HttpError(400, mode === "failed" ? "No failed records to retry" : "Run has no records");
  const { id } = await createRun({
    ws, kind: run.kind as RunKind, workflowId: run.workflow_id as string | null, workflowVersion: run.workflow_version as number | null, workflowName: run.workflow_name as string | null,
    trigger: mode === "failed" ? "retry_failed" : "retry", records: items.map((i) => i.input as Record<string, unknown>), input: run.input as Record<string, unknown>,
    isTest: !!run.is_test, createdBy: userId, parentRunId: runId, itemKeys: items.map((i) => (i.item_key as string) ?? null),
    itemState: mode === "failed" ? items.map((i) => ({ context: i.context as Record<string, unknown>, current_step: Number(i.current_step) })) : undefined,
  });
  await sql`update automation_runs set retry_count = retry_count + 1, updated_at = now() where id = ${runId}`;
  await log(ws, runId, `Retry started (${mode === "failed" ? "failed records" : "entire run"}) → run ${id}`);
  if (run.kind === "campaign" && mode === "failed") {
    // failed campaign messages go back to the queue
    await sql`update campaign_messages set status = 'queued', error = null, updated_at = now() where run_id = ${runId} and status = 'failed'`;
  }
  return { id, dispatch: await dispatchRun(ws, id) };
}

export async function resumeRuns(ws: string, workflowId: string) {
  const runs = await db()`update automation_runs set status = 'running', updated_at = now() where workflow_id = ${workflowId} and workspace_id = ${ws} and status = 'paused' returning id`;
  for (const r of runs) { await log(ws, String(r.id), "Resumed"); await dispatchRun(ws, String(r.id)); }
  return runs.length;
}

/** Test runs execute inline (one record, bounded) — no n8n needed. */
export async function executeInline(runId: string, budgetMs = 50000) {
  const started = Date.now();
  let r: StepResult;
  do { r = await stepRun(runId, Math.max(5000, budgetMs - (Date.now() - started))); } while (r.action === "continue" && Date.now() - started < budgetMs);
  return r;
}

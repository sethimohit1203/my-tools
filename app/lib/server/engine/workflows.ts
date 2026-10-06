// Workflow lifecycle: save, validate, activate (version + nodes + schedule +
// n8n sync), pause, resume, duplicate, delete, run, test.
import { db, HttpError } from "../db";
import { capabilityStatus } from "../integrations";
import { ACTIONS, TRIGGERS, requiredIntegrations, type Definition } from "../../automation/types";
import { createRun, dispatchRun, executeInline, resumeRuns, log } from "./runs";
import { cronFor, nextRunAt, type ScheduleSpec } from "./schedule";
import { deleteN8nWorkflow, n8nApiAvailable, scheduleWorkflow, setN8nWorkflowActive, upsertScheduleWorkflow } from "./n8n";

export type WorkflowRow = { id: string; workspace_id: string; name: string; description: string; type: string; status: string; trigger_type: string; definition: Definition; version: number; n8n_workflow_id: string | null; template_key: string | null };

export async function getWorkflow(ws: string, id: string): Promise<WorkflowRow> {
  const [w] = await db()`select * from automation_workflows where id = ${id} and workspace_id = ${ws}`;
  if (!w) throw new HttpError(404, "Workflow not found");
  return w as unknown as WorkflowRow;
}

export function normalizeDefinition(d: Partial<Definition>): Definition {
  const steps = (d.steps || []).map((n, i) => ({ key: String(n.key || `step${i + 1}`).replace(/[^\w-]/g, "_"), type: n.type, name: n.name || ACTIONS[n.type]?.label || n.type, config: n.config || {} }));
  return { trigger: { type: d.trigger?.type || "manual", config: d.trigger?.config || {} }, steps, settings: d.settings || {} };
}

export function validateDefinition(def: Definition): string[] {
  const errs: string[] = [];
  const trig = TRIGGERS[def.trigger.type];
  if (!trig) errs.push(`Unknown trigger "${def.trigger.type}"`);
  else for (const f of trig.fields) if (f.required && !def.trigger.config?.[f.key]) errs.push(`Trigger: "${f.label}" is required`);
  if (def.trigger.type === "schedule") {
    const k = String(def.trigger.config.kind || "");
    if (!["once", "hourly", "daily", "weekly", "monthly", "interval"].includes(k)) errs.push("Schedule: choose how often it repeats");
    if (k === "once" && !def.trigger.config.run_at) errs.push("Schedule: set the date/time for a one-off run");
    if (k === "interval" && !(Number(def.trigger.config.interval_minutes) >= 5)) errs.push("Schedule: interval must be at least 5 minutes");
    if (def.trigger.config.input) { try { JSON.parse(String(def.trigger.config.input)); } catch { errs.push("Schedule: input must be valid JSON"); } }
  }
  if (!def.steps.length) errs.push("Add at least one action");
  const keys = new Set<string>();
  def.steps.forEach((n, i) => {
    const a = ACTIONS[n.type];
    if (!a) { errs.push(`Step ${i + 1}: unknown action "${n.type}"`); return; }
    if (keys.has(n.key)) errs.push(`Step ${i + 1}: duplicate step name "${n.key}"`);
    keys.add(n.key);
    for (const f of a.fields) {
      if (!f.required) continue;
      const v = n.config?.[f.key];
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) errs.push(`Step ${i + 1} (${n.name}): "${f.label}" is required`);
    }
    if (n.type === "delay" && !(Number(n.config.amount) > 0)) errs.push(`Step ${i + 1}: delay amount must be > 0`);
    for (const k of ["headers", "body", "acf", "schema"]) {
      const v = n.config?.[k];
      if (typeof v === "string" && v.trim() && !v.includes("{{")) { try { JSON.parse(v); } catch { errs.push(`Step ${i + 1}: "${k}" must be valid JSON`); } }
    }
  });
  return errs;
}

export async function missingIntegrations(ws: string, def: Definition) {
  const caps = await capabilityStatus(ws);
  return requiredIntegrations(def).filter((r) => !caps[r]);
}

export async function saveWorkflow(ws: string, userId: string, input: { id?: string; name?: string; description?: string; type?: string; definition?: Partial<Definition>; template_key?: string }) {
  const def = normalizeDefinition(input.definition || {});
  const sql = db();
  if (input.id) {
    const cur = await getWorkflow(ws, input.id);
    const [w] = await sql`update automation_workflows set name = ${input.name ?? cur.name}, description = ${input.description ?? cur.description}, definition = ${sql.json(def as never)}, trigger_type = ${def.trigger.type}, updated_at = now() where id = ${input.id} returning *`;
    return w as unknown as WorkflowRow;
  }
  const [w] = await sql`insert into automation_workflows (workspace_id, name, description, type, status, trigger_type, definition, template_key, created_by)
    values (${ws}, ${input.name || "Untitled workflow"}, ${input.description || ""}, ${input.type || "custom"}, 'draft', ${def.trigger.type}, ${sql.json(def as never)}, ${input.template_key ?? null}, ${userId}) returning *`;
  return w as unknown as WorkflowRow;
}

/** Validate → new version → nodes → schedule/webhook → n8n → active. */
export async function activateWorkflow(ws: string, id: string, userId: string) {
  const wf = await getWorkflow(ws, id);
  const def = normalizeDefinition(wf.definition);
  const errors = validateDefinition(def);
  const missing = await missingIntegrations(ws, def);
  if (missing.length) errors.push(`Integration Required: ${missing.join(", ")} — configure in Settings → Integrations`);
  const needsN8n = !["manual"].includes(def.trigger.type);
  if (needsN8n && !missing.includes("n8n")) {
    const caps = await capabilityStatus(ws);
    if (!caps.n8n) errors.push("Integration Required: n8n — event, webhook and scheduled runs are executed by n8n");
  }
  if (errors.length) throw new HttpError(400, "Workflow can't be activated", "invalid", errors);
  const sql = db();
  const version = wf.version + 1;
  await sql.begin(async (tx) => {
    await tx`insert into automation_workflow_versions (workflow_id, version, definition, created_by) values (${id}, ${version}, ${tx.json(def as never)}, ${userId})`;
    const nodes = [{ workflow_id: id, version, node_key: "trigger", kind: "trigger", type: def.trigger.type, name: TRIGGERS[def.trigger.type].label, config: tx.json(def.trigger.config as never), position: 0 },
      ...def.steps.map((n, i) => ({ workflow_id: id, version, node_key: n.key, kind: n.type === "condition" ? "condition" : "action", type: n.type, name: n.name, config: tx.json(n.config as never), position: i + 1 }))];
    await tx`insert into automation_nodes ${tx(nodes as never, "workflow_id", "version", "node_key", "kind", "type", "name", "config", "position")}`;
    await tx`update automation_workflows set version = ${version}, status = 'active', definition = ${tx.json(def as never)}, updated_at = now() where id = ${id}`;
  });
  const notes: string[] = [];
  if (def.trigger.type === "schedule") notes.push(...(await syncSchedule(ws, { ...wf, version }, def)));
  else await clearSchedule(ws, id);
  if (["webhook", "wordpress_event"].includes(def.trigger.type)) {
    const [ep] = await sql`select id from webhook_endpoints where workflow_id = ${id} limit 1`;
    if (!ep) {
      const { createEndpoint } = await import("../webhooks");
      const r = await createEndpoint(ws, { workflowId: id, name: wf.name });
      notes.push(`Webhook created — copy the URL and secret from Webhooks (secret shown once: ${r.secret})`);
    }
  }
  return { version, notes };
}

async function syncSchedule(ws: string, wf: WorkflowRow, def: Definition) {
  const sql = db();
  const c = def.trigger.config as Record<string, unknown>;
  const spec: ScheduleSpec = { kind: String(c.kind), at_time: (c.at_time as string) || null, day_of_week: c.day_of_week != null && c.day_of_week !== "" ? Number(c.day_of_week) : null, day_of_month: c.day_of_month != null && c.day_of_month !== "" ? Number(c.day_of_month) : null, interval_minutes: c.interval_minutes ? Number(c.interval_minutes) : null, run_at: (c.run_at as string) || null, timezone: (c.timezone as string) || "Asia/Kolkata" };
  const next = nextRunAt(spec);
  if (!next) throw new HttpError(400, "Schedule never runs in the future — check the date/time");
  const [s] = await sql`insert into automation_schedules (workspace_id, workflow_id, kind, interval_minutes, at_time, day_of_week, day_of_month, run_at, timezone, status, next_run_at)
    values (${ws}, ${wf.id}, ${spec.kind}, ${spec.interval_minutes ?? null}, ${spec.at_time ?? null}, ${spec.day_of_week ?? null}, ${spec.day_of_month ?? null}, ${spec.run_at ?? null}, ${spec.timezone!}, 'active', ${next})
    on conflict (workflow_id) do update set kind = excluded.kind, interval_minutes = excluded.interval_minutes, at_time = excluded.at_time, day_of_week = excluded.day_of_week, day_of_month = excluded.day_of_month, run_at = excluded.run_at, timezone = excluded.timezone, status = 'active', next_run_at = excluded.next_run_at, updated_at = now()
    returning *`;
  const cron = cronFor(spec);
  if (cron && (await n8nApiAvailable(ws))) {
    const n8nId = await upsertScheduleWorkflow(ws, (s.n8n_workflow_id as string) || wf.n8n_workflow_id, scheduleWorkflow(wf.name, cron, spec.timezone!, wf.id, String(s.id)));
    await sql`update automation_schedules set n8n_workflow_id = ${n8nId} where id = ${s.id}`;
    await sql`update automation_workflows set n8n_workflow_id = ${n8nId} where id = ${wf.id}`;
    return [`n8n schedule workflow active (cron "${cron}", ${spec.timezone})`];
  }
  if (s.n8n_workflow_id) { await deleteN8nWorkflow(ws, String(s.n8n_workflow_id)).catch(() => null); await sql`update automation_schedules set n8n_workflow_id = null where id = ${s.id}`; await sql`update automation_workflows set n8n_workflow_id = null where id = ${wf.id}`; }
  return ["Scheduled via the n8n ticker (checks every 5 minutes)"];
}

async function clearSchedule(ws: string, workflowId: string) {
  const sql = db();
  const [s] = await sql`delete from automation_schedules where workflow_id = ${workflowId} returning n8n_workflow_id`;
  if (s?.n8n_workflow_id) await deleteN8nWorkflow(ws, String(s.n8n_workflow_id)).catch(() => null);
  await sql`update automation_workflows set n8n_workflow_id = null where id = ${workflowId}`;
}

export async function pauseWorkflow(ws: string, id: string) {
  const wf = await getWorkflow(ws, id);
  const sql = db();
  await sql`update automation_workflows set status = 'paused', updated_at = now() where id = ${id}`;
  await sql`update automation_schedules set status = 'paused', updated_at = now() where workflow_id = ${id}`;
  await sql`update webhook_endpoints set status = 'disabled', updated_at = now() where workflow_id = ${id}`;
  if (wf.n8n_workflow_id) await setN8nWorkflowActive(ws, wf.n8n_workflow_id, false).catch(() => null);
  return { paused: true };
}

export async function resumeWorkflow(ws: string, id: string) {
  const wf = await getWorkflow(ws, id);
  if (wf.version === 0) throw new HttpError(400, "Activate the workflow first");
  const sql = db();
  await sql`update automation_workflows set status = 'active', updated_at = now() where id = ${id}`;
  await sql`update webhook_endpoints set status = 'active', updated_at = now() where workflow_id = ${id}`;
  const [s] = await sql`select * from automation_schedules where workflow_id = ${id}`;
  if (s) {
    const next = nextRunAt(s as unknown as ScheduleSpec);
    await sql`update automation_schedules set status = 'active', next_run_at = ${next}, updated_at = now() where id = ${s.id}`;
  }
  if (wf.n8n_workflow_id) await setN8nWorkflowActive(ws, wf.n8n_workflow_id, true);
  const resumed = await resumeRuns(ws, id);
  return { resumed_runs: resumed };
}

export async function duplicateWorkflow(ws: string, id: string, userId: string) {
  const wf = await getWorkflow(ws, id);
  return saveWorkflow(ws, userId, { name: `${wf.name} (copy)`, description: wf.description, type: wf.type, definition: wf.definition, template_key: wf.template_key || undefined });
}

export async function deleteWorkflow(ws: string, id: string) {
  const wf = await getWorkflow(ws, id);
  await clearSchedule(ws, id).catch(() => null);
  if (wf.n8n_workflow_id) await deleteN8nWorkflow(ws, wf.n8n_workflow_id).catch(() => null);
  await db()`delete from automation_workflows where id = ${id}`;
}

function parseRecords(input: unknown): Record<string, unknown>[] {
  if (input == null || input === "") return [{}];
  const v = typeof input === "string" ? JSON.parse(input) : input;
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (x && typeof x === "object" ? x : { value: x })) as Record<string, unknown>[];
}

/** Start a real run of an active workflow (n8n executes it). */
export async function startWorkflowRun(ws: string, wfOrId: string | WorkflowRow, o: { trigger: string; records?: unknown; userId?: string | null; idempotencyKey?: string; itemKeys?: (string | null)[] }) {
  const wf = typeof wfOrId === "string" ? await getWorkflow(ws, wfOrId) : wfOrId;
  if (wf.status !== "active") throw new HttpError(409, `Workflow is ${wf.status} — activate it first`);
  let records: Record<string, unknown>[];
  try { records = parseRecords(o.records); } catch { throw new HttpError(400, "Input must be valid JSON (an object or an array of objects)"); }
  const def = normalizeDefinition(wf.definition);
  const run = await createRun({ ws, workflowId: wf.id, workflowVersion: wf.version, workflowName: wf.name, trigger: o.trigger, records, createdBy: o.userId, idempotencyKey: o.idempotencyKey, itemKeys: o.itemKeys, maxAttempts: def.settings?.maxAttempts || 3, input: { ratePerMinute: def.settings?.ratePerMinute || 0 } });
  if (run.duplicate) return { run_id: run.id, duplicate: true, dispatched: true };
  const d = await dispatchRun(ws, run.id);
  return { run_id: run.id, dispatched: d.dispatched, error: d.error };
}

/** Test run: one record, inline, side effects dry-run unless confirmLive. */
export async function testWorkflow(ws: string, id: string, o: { input?: unknown; definition?: Partial<Definition>; confirmLive?: boolean; userId: string }) {
  const wf = await getWorkflow(ws, id);
  const def = normalizeDefinition(o.definition || wf.definition);
  const errors = validateDefinition(def).filter((e) => !e.startsWith("Trigger:"));
  const missing = (await missingIntegrations(ws, def)).filter((m) => m !== "n8n");
  if (missing.length) errors.push(`Integration Required: ${missing.join(", ")}`);
  if (errors.length) throw new HttpError(400, "Fix these before testing", "invalid", errors);
  let records: Record<string, unknown>[];
  try { records = parseRecords(o.input ?? def.settings?.sampleInput); } catch { throw new HttpError(400, "Test input must be valid JSON"); }
  const run = await createRun({ ws, workflowId: wf.id, workflowVersion: null, workflowName: wf.name, trigger: "test", records: records.slice(0, 1), isTest: true, createdBy: o.userId, maxAttempts: 1, input: { definition: def, confirm_live: !!o.confirmLive } });
  await log(ws, run.id, o.confirmLive ? "Test with LIVE side effects (confirmed by user)" : "Test mode: messages/posts are not really sent (dry run)");
  const result = await executeInline(run.id, 50000);
  return { run_id: run.id, ...result };
}

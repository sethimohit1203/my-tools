import { authed, body } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { deleteWorkflow, getWorkflow, missingIntegrations, normalizeDefinition, saveWorkflow, validateDefinition } from "@/app/lib/server/engine/workflows";

export const GET = authed(async (_req, a, p) => {
  const wf = await getWorkflow(a.workspaceId, p.id);
  const sql = db();
  const def = normalizeDefinition(wf.definition);
  const [schedule] = await sql`select * from automation_schedules where workflow_id = ${p.id}`;
  const webhooks = await sql`select id, name, method, auth_mode, status, secret_prefix, call_count, last_called_at from webhook_endpoints where workflow_id = ${p.id}`;
  const versions = await sql`select version, created_at from automation_workflow_versions where workflow_id = ${p.id} order by version desc limit 10`;
  const runs = await sql`select id, status, trigger, is_test, records_total, records_success, records_failed, records_skipped, created_at, completed_at, duration_ms, dispatch_error from automation_runs where workflow_id = ${p.id} order by created_at desc limit 15`;
  const [cursor] = await sql`select * from sheet_trigger_cursors where workflow_id = ${p.id}`;
  return { workflow: wf, validation: validateDefinition(def), missing: await missingIntegrations(a.workspaceId, def), schedule: schedule || null, webhooks, versions, runs, sheet_cursor: cursor || null };
});

export const PUT = authed(async (req, a, p) => ({ workflow: await saveWorkflow(a.workspaceId, a.userId, { ...(await body(req)), id: p.id }) }));

export const DELETE = authed(async (_req, a, p) => { await deleteWorkflow(a.workspaceId, p.id); return { ok: true }; });

import { authed, body } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { saveWorkflow } from "@/app/lib/server/engine/workflows";

export const GET = authed(async (_req, a) => ({
  workflows: await db()`select w.id, w.name, w.description, w.type, w.status, w.trigger_type, w.version, w.template_key, w.updated_at, w.last_run_at, w.n8n_workflow_id,
      (select status from automation_runs r where r.workflow_id = w.id and r.is_test = false order by created_at desc limit 1) as last_run_status,
      (select count(*)::int from automation_runs r where r.workflow_id = w.id and r.status in ('queued','running')) as running,
      s.next_run_at
    from automation_workflows w left join automation_schedules s on s.workflow_id = w.id and s.status = 'active'
    where w.workspace_id = ${a.workspaceId} order by w.updated_at desc`,
}));

export const POST = authed(async (req, a) => ({ workflow: await saveWorkflow(a.workspaceId, a.userId, await body(req)) }));

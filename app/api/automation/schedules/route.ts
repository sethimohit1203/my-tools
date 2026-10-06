import { authed } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { describeSchedule } from "@/app/lib/server/engine/schedule";

export const GET = authed(async (_req, a) => {
  const rows = await db()`select s.*, w.name as workflow_name, w.status as workflow_status, r.status as last_run_status from automation_schedules s join automation_workflows w on w.id = s.workflow_id left join automation_runs r on r.id = s.last_run_id where s.workspace_id = ${a.workspaceId} order by s.next_run_at nulls last`;
  return { schedules: rows.map((r) => ({ ...r, description: describeSchedule(r as never), executor: r.n8n_workflow_id ? "n8n cron workflow" : "n8n ticker" })) };
});

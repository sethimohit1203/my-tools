import { authed, body } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { createEndpoint } from "@/app/lib/server/webhooks";

export const GET = authed(async (_req, a) => ({
  webhooks: await db()`select e.id, e.name, e.method, e.auth_mode, e.status, e.secret_prefix, e.rate_limit_per_min, e.max_body_kb, e.call_count, e.last_called_at, e.created_at, e.workflow_id, w.name as workflow_name, w.status as workflow_status
    from webhook_endpoints e left join automation_workflows w on w.id = e.workflow_id where e.workspace_id = ${a.workspaceId} order by e.created_at desc`,
}));

export const POST = authed(async (req, a) => {
  const b = await body<{ workflow_id?: string; name?: string; method?: string; auth_mode?: string; rate_limit_per_min?: number }>(req);
  if (b.workflow_id) { const [w] = await db()`select id from automation_workflows where id = ${b.workflow_id} and workspace_id = ${a.workspaceId}`; if (!w) return { error: "Workflow not found" }; }
  return createEndpoint(a.workspaceId, { workflowId: b.workflow_id, name: b.name, method: b.method, authMode: b.auth_mode, ratePerMin: b.rate_limit_per_min });
});

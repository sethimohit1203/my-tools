import { authed, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";

export const GET = authed(async (req, a, p) => {
  const sql = db();
  const [run] = await sql`select * from automation_runs where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  if (!run) throw new HttpError(404, "Run not found");
  const itemStatus = req.nextUrl.searchParams.get("items");
  const logs = await sql`select id, level, service, step, message, data, item_id, created_at from execution_logs where run_id = ${p.id} order by id limit 1000`;
  const items = await sql`select id, seq, item_key, status, attempts, max_attempts, current_step, next_attempt_at, input, output, error, started_at, completed_at from automation_run_items where run_id = ${p.id} ${itemStatus ? sql`and status = ${itemStatus}` : sql``} order by seq limit 500`;
  const steps = await sql`select id, item_id, node_key, step_index, step_type, service, status, attempt, input, output, error, http_status, provider_response, recommended_action, started_at, duration_ms from automation_step_runs where run_id = ${p.id} order by started_at limit 2000`;
  const [usage] = await sql`select coalesce(sum((u->>'input_tokens')::int),0)::int as input_tokens, coalesce(sum((u->>'output_tokens')::int),0)::int as output_tokens, count(*)::int as calls
    from automation_step_runs s, jsonb_array_elements(case when jsonb_typeof(s.output->'_usage') = 'array' then s.output->'_usage' when s.output ? 'usage' then jsonb_build_array(s.output->'usage') else '[]'::jsonb end) u where s.run_id = ${p.id}`;
  const children = await sql`select id, status, trigger, created_at from automation_runs where parent_run_id = ${p.id} order by created_at`;
  return { run, logs, items, steps, ai_usage: usage, children };
});

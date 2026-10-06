import { authed } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";

export const GET = authed(async (req, a) => {
  const q = req.nextUrl.searchParams;
  const sql = db();
  const status = q.get("status"), wf = q.get("workflow_id"), kind = q.get("kind"), tests = q.get("tests") === "1";
  const limit = Math.min(Number(q.get("limit") || 50), 200), offset = Number(q.get("offset") || 0);
  const runs = await sql`select id, workflow_id, workflow_name, kind, trigger, status, is_test, records_total, records_success, records_failed, records_skipped, retry_count, started_at, completed_at, created_at, duration_ms, dispatch_error, parent_run_id
    from automation_runs where workspace_id = ${a.workspaceId}
    ${status ? sql`and status = ${status}` : sql``} ${wf ? sql`and workflow_id = ${wf}` : sql``} ${kind ? sql`and kind = ${kind}` : sql``} ${tests ? sql`` : sql`and is_test = false`}
    order by created_at desc limit ${limit} offset ${offset}`;
  return { runs };
});

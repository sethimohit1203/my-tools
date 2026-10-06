import { authed } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";

export const GET = authed(async (_req, a, p) => ({
  requests: await db()`select id, method, headers, query, body, status_code, error, run_id, ip, received_at from webhook_requests where endpoint_id = ${p.id} and workspace_id = ${a.workspaceId} order by received_at desc limit 50`,
}));

export const DELETE = authed(async (_req, a, p) => { await db()`delete from webhook_endpoints where id = ${p.id} and workspace_id = ${a.workspaceId}`; return { ok: true }; });

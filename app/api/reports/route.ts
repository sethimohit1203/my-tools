import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { REPORT_TYPES } from "@/app/lib/server/reports";

export const GET = authed(async (_req, a) => ({
  reports: await db()`select r.*, (select json_build_object('id', x.id, 'status', x.status, 'created_at', x.created_at, 'emailed_to', x.emailed_to, 'error', x.error) from report_runs x where x.report_id = r.id order by x.created_at desc limit 1) as last_run from reports r where r.workspace_id = ${a.workspaceId} order by r.created_at desc`,
}));

export const POST = authed(async (req, a) => {
  const b = await body<{ name: string; type: string; config?: Record<string, unknown> }>(req);
  if (!(b.type in REPORT_TYPES)) throw new HttpError(400, "Unknown report type");
  const [r] = await db()`insert into reports (workspace_id, name, type, config) values (${a.workspaceId}, ${b.name || REPORT_TYPES[b.type as keyof typeof REPORT_TYPES]}, ${b.type}, ${db().json((b.config || {}) as never)}) returning *`;
  return { report: r };
});

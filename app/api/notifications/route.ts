import { authed, body } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";

export const GET = authed(async (_req, a) => ({ notifications: await db()`select * from notifications where workspace_id = ${a.workspaceId} order by created_at desc limit 100` }));

export const POST = authed(async (req, a) => {
  const b = await body<{ ids?: string[]; all?: boolean }>(req);
  const sql = db();
  if (b.all) await sql`update notifications set read_at = now() where workspace_id = ${a.workspaceId} and read_at is null`;
  else if (b.ids?.length) await sql`update notifications set read_at = now() where workspace_id = ${a.workspaceId} and id in ${sql(b.ids)}`;
  return { ok: true };
});

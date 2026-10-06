import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";

export const GET = authed(async (_req, a, p) => {
  const [r] = await db()`select * from reports where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  if (!r) throw new HttpError(404, "Report not found");
  const runs = await db()`select id, status, period_start, period_end, data, analysis, warnings, pdf_path, emailed_to, emailed_at, error, created_at, completed_at, run_id from report_runs where report_id = ${p.id} order by created_at desc limit 24`;
  return { report: r, runs };
});

export const PUT = authed(async (req, a, p) => {
  const b = await body<{ name?: string; config?: Record<string, unknown> }>(req);
  const sql = db();
  await sql`update reports set name = coalesce(${b.name ?? null}, name), config = ${b.config ? sql.json(b.config as never) : sql`config`}, updated_at = now() where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  return { ok: true };
});

export const DELETE = authed(async (_req, a, p) => { await db()`delete from reports where id = ${p.id} and workspace_id = ${a.workspaceId}`; return { ok: true }; });

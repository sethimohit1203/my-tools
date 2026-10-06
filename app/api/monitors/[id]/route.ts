import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";

export const GET = authed(async (_req, a, p) => {
  const [m] = await db()`select * from monitors where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  if (!m) throw new HttpError(404, "Monitor not found");
  const checks = await db()`select id, checked_at, up, http_status, response_ms, changes, significant, error from monitor_checks where monitor_id = ${p.id} order by checked_at desc limit 100`;
  return { monitor: m, checks };
});

export const PATCH = authed(async (req, a, p) => {
  const b = await body<{ status?: string; label?: string; frequency_minutes?: number; notify?: unknown; important_text?: string; type?: string; track_sitemap?: boolean }>(req);
  const sql = db();
  await sql`update monitors set status = coalesce(${b.status ?? null}, status), label = coalesce(${b.label ?? null}, label), frequency_minutes = coalesce(${b.frequency_minutes ?? null}, frequency_minutes),
    notify = ${b.notify ? sql.json(b.notify as never) : sql`notify`}, important_text = ${b.important_text === undefined ? sql`important_text` : b.important_text || null}, type = coalesce(${b.type ?? null}, type), track_sitemap = coalesce(${b.track_sitemap ?? null}, track_sitemap),
    next_check_at = case when ${b.status ?? ""} = 'active' then now() else next_check_at end, updated_at = now() where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  return { ok: true };
});

export const DELETE = authed(async (_req, a, p) => { await db()`delete from monitors where id = ${p.id} and workspace_id = ${a.workspaceId}`; return { ok: true }; });

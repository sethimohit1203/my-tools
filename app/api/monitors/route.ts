import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { normalizeUrl } from "@/app/lib/server/fetch-page";

const FREQ = [360, 720, 1440, 10080];

export const GET = authed(async (_req, a) => ({
  monitors: await db()`select m.*, (select json_agg(x) from (select checked_at, up, response_ms, significant, changes from monitor_checks c where c.monitor_id = m.id and (c.significant or not c.up) order by checked_at desc limit 5) x) as recent_alerts from monitors m where m.workspace_id = ${a.workspaceId} order by m.created_at desc`,
}));

export const POST = authed(async (req, a) => {
  const b = await body<{ url: string; label?: string; type?: string; frequency_minutes?: number; notify?: { in_app?: boolean; email?: boolean }; important_text?: string; track_sitemap?: boolean }>(req);
  let url: string;
  try { url = normalizeUrl(b.url); } catch { throw new HttpError(400, "Enter a valid URL"); }
  const freq = FREQ.includes(Number(b.frequency_minutes)) ? Number(b.frequency_minutes) : 1440;
  const sql = db();
  const [m] = await sql`insert into monitors (workspace_id, url, label, type, frequency_minutes, notify, important_text, track_sitemap, next_check_at)
    values (${a.workspaceId}, ${url}, ${b.label || null}, ${b.type || "full"}, ${freq}, ${sql.json((b.notify || { in_app: true, email: false }) as never)}, ${b.important_text || null}, ${b.track_sitemap !== false}, now()) returning *`;
  return { monitor: m };
});

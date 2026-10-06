import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { contentHash } from "@/app/lib/server/social-posts";

export const PATCH = authed(async (req, a, p) => {
  const b = await body<{ caption?: string; hashtags?: string; media_urls?: string[]; scheduled_for?: string | null; approval_mode?: string }>(req);
  const sql = db();
  const [cur] = await sql`select * from social_posts where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  if (!cur) throw new HttpError(404, "Post not found");
  if (["publishing", "published"].includes(String(cur.status))) throw new HttpError(409, `Can't edit a ${cur.status} post`);
  const caption = b.caption ?? String(cur.caption), hashtags = b.hashtags ?? String(cur.hashtags), media = b.media_urls ?? (cur.media_urls as string[]);
  const hash = contentHash(String(cur.platform), String(cur.account), caption, hashtags, media);
  try {
    await sql`update social_posts set caption = ${caption}, hashtags = ${hashtags}, media_urls = ${media}, scheduled_for = ${b.scheduled_for === undefined ? (cur.scheduled_for as string | null) : b.scheduled_for || null}, approval_mode = ${b.approval_mode ?? String(cur.approval_mode)}, content_hash = ${hash},
      status = case when status in ('approved','scheduled') and approval_mode = 'manual' then 'awaiting_approval' else status end, updated_at = now() where id = ${p.id}`;
  } catch { throw new HttpError(409, "An identical post already exists (duplicate prevented)"); }
  return { ok: true };
});

export const DELETE = authed(async (_req, a, p) => {
  const [r] = await db()`delete from social_posts where id = ${p.id} and workspace_id = ${a.workspaceId} and status not in ('publishing') returning id`;
  if (!r) throw new HttpError(409, "Post not found or currently publishing");
  return { ok: true };
});

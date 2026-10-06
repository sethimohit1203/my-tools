// Social publishing pipeline: draft → awaiting_approval → approved/scheduled
// → publishing → published | failed. Duplicates prevented by content hash
// per platform/account and by never re-publishing a post with a provider id.
import { db, HttpError } from "./db";
import { ActionError } from "./errors";
import { sha256 } from "./crypto";
import { publishSocial } from "./social";
import { notify } from "./notify";
import { createRun, dispatchRun, executeInline, registerKind, type ExecEnv } from "./engine/runs";

export const contentHash = (platform: string, account: string, caption: string, hashtags: string, media: string[]) => sha256([platform, account, caption.trim(), hashtags.trim(), ...media].join("|"));

async function publishItem(env: ExecEnv) {
  const sql = db();
  const [p] = await sql`select * from social_posts where id = ${String(env.item.input.post_id)} and workspace_id = ${env.ws}`;
  if (!p) return { __skipItem: "post deleted" };
  if (p.provider_post_id) return { __skipItem: "already published (duplicate prevented)", provider_post_id: p.provider_post_id };
  if (!["approved", "scheduled", "publishing", "failed"].includes(String(p.status))) return { __skipItem: `post is ${p.status}` };
  const expected = { platform: p.platform, caption: p.caption, hashtags: p.hashtags, media: p.media_urls };
  if (env.testMode && !env.confirmLive) return { __dryRun: { would: `publish to ${p.platform}`, ...expected } };
  await sql`update social_posts set status = 'publishing', attempts = attempts + 1, run_id = ${env.run.id}, updated_at = now() where id = ${p.id}`;
  try {
    const r = await publishSocial(env.ws, { platform: String(p.platform), caption: String(p.caption), hashtags: String(p.hashtags), media_urls: p.media_urls as string[], id: String(p.id) });
    await sql`update social_posts set status = 'published', provider_post_id = ${r.id}, provider_url = ${r.url ?? null}, provider_response = ${sql.json((r.response ?? null) as never)}, error = null, published_at = now(), updated_at = now() where id = ${p.id}`;
    return { published: true, provider_post_id: r.id, url: r.url };
  } catch (e) {
    const ae = e as ActionError;
    const final = !ae.retryable || env.item.attempts + 1 >= env.item.max_attempts;
    await sql`update social_posts set status = ${final ? "failed" : "publishing"}, error = ${ae.message}, provider_response = ${ae.providerResponse ? sql.json(ae.providerResponse as never) : null}, updated_at = now() where id = ${p.id}`;
    if (final) await notify(env.ws, { type: "social_failed", severity: "error", title: `${p.platform} post failed`, body: ae.message, link: "/social" });
    throw e;
  }
}
registerKind("social", publishItem);

export async function socialTick() {
  const sql = db();
  const due = await sql`select id, workspace_id from social_posts where status in ('approved','scheduled') and (scheduled_for is null or scheduled_for <= now()) and provider_post_id is null order by scheduled_for nulls first limit 100`;
  const by = new Map<string, string[]>();
  for (const d of due) by.set(String(d.workspace_id), [...(by.get(String(d.workspace_id)) || []), String(d.id)]);
  for (const [ws, ids] of by) {
    await sql`update social_posts set status = 'publishing', updated_at = now() where id in ${sql(ids)}`;
    const { id } = await createRun({ ws, kind: "social", trigger: "schedule", workflowName: "Social publishing", records: ids.map((post_id) => ({ post_id })), maxAttempts: 3 });
    await dispatchRun(ws, id);
  }
  return { queued: due.length };
}

export async function createPost(ws: string, p: { platform: string; account?: string; caption: string; hashtags?: string; media_urls?: string[]; topic?: string; scheduled_for?: string | null; approval_mode?: string }) {
  if (!p.caption?.trim()) throw new HttpError(400, "Caption is required");
  if (!["facebook", "instagram", "linkedin", "webhook"].includes(p.platform)) throw new HttpError(400, "Choose a platform");
  if (p.platform === "instagram" && !p.media_urls?.[0]) throw new HttpError(400, "Instagram needs an image URL");
  const account = p.account || "default", media = (p.media_urls || []).filter(Boolean);
  const hash = contentHash(p.platform, account, p.caption, p.hashtags || "", media);
  const [row] = await db()`insert into social_posts (workspace_id, platform, account, caption, hashtags, media_urls, topic, scheduled_for, status, approval_mode, content_hash)
    values (${ws}, ${p.platform}, ${account}, ${p.caption}, ${p.hashtags || ""}, ${media}, ${p.topic ?? null}, ${p.scheduled_for || null}, ${p.approval_mode === "auto" ? (p.scheduled_for ? "scheduled" : "draft") : "draft"}, ${p.approval_mode === "auto" ? "auto" : "manual"}, ${hash})
    on conflict (workspace_id, platform, account, content_hash) do nothing returning *`;
  if (!row) throw new HttpError(409, "An identical post already exists for this platform/account (duplicate prevented)");
  return row;
}

export async function transitionPost(ws: string, id: string, action: string, userId?: string) {
  const sql = db();
  const [p] = await sql`select * from social_posts where id = ${id} and workspace_id = ${ws}`;
  if (!p) throw new HttpError(404, "Post not found");
  const st = String(p.status);
  const set = async (status: string) => { await sql`update social_posts set status = ${status}, updated_at = now() where id = ${id}`; return { status }; };
  switch (action) {
    case "submit": if (st !== "draft") throw new HttpError(409, `Post is ${st}`); return set(p.approval_mode === "auto" ? (p.scheduled_for ? "scheduled" : "approved") : "awaiting_approval");
    case "approve": if (!["awaiting_approval", "draft"].includes(st)) throw new HttpError(409, `Post is ${st}`); return set(p.scheduled_for && new Date(p.scheduled_for as string) > new Date() ? "scheduled" : "approved");
    case "reject": return set("draft");
    case "cancel": if (["published", "publishing"].includes(st)) throw new HttpError(409, `Post is ${st}`); return set("cancelled");
    case "retry": if (st !== "failed") throw new HttpError(409, "Only failed posts can be retried"); return set("approved");
    case "publish_now": {
      if (p.provider_post_id) throw new HttpError(409, "Already published");
      if (!["approved", "scheduled", "awaiting_approval", "failed"].includes(st)) throw new HttpError(409, `Post is ${st}`);
      await sql`update social_posts set status = 'approved', updated_at = now() where id = ${id}`;
      const { id: runId } = await createRun({ ws, kind: "social", trigger: "manual", workflowName: "Publish now", records: [{ post_id: id }], createdBy: userId, maxAttempts: 1, input: { confirm_live: true } });
      const r = await executeInline(runId, 50000);
      return { run_id: runId, ...r };
    }
  }
  throw new HttpError(400, "Unknown action");
}

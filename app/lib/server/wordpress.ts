// WordPress REST API with duplicate prevention via wp_publications
// (workspace + site + external_id → post id).
import { db } from "./db";
import { ActionError, providerFetch } from "./errors";
import { setIntegrationStatus, useIntegration } from "./integrations";
import { assertPublicUrl, normalizeUrl } from "./fetch-page";
import { integrationGate } from "./ratelimit";
import { sha256 } from "./crypto";

type Creds = { base: string; auth: string; config: Record<string, string> };

async function creds(ws: string): Promise<Creds> {
  const i = await useIntegration(ws, "wordpress");
  return { base: normalizeUrl(i.config.url).replace(/\/$/, ""), auth: "Basic " + Buffer.from(`${i.config.username}:${i.secrets.app_password}`).toString("base64"), config: i.config };
}

export async function wp<T = unknown>(ws: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const c = await creds(ws);
  await integrationGate(ws, "wordpress");
  const url = c.base + path;
  await assertPublicUrl(url);
  try {
    const { data } = await providerFetch("wordpress", url, {
      method, headers: { Authorization: c.auth, Accept: "application/json", ...(body instanceof Buffer ? headers : { "Content-Type": "application/json", ...headers }) },
      body: body == null ? undefined : body instanceof Buffer ? new Uint8Array(body) : JSON.stringify(body), timeoutMs: 45000,
    });
    return data as T;
  } catch (e) {
    const ae = e as ActionError;
    if (ae.httpStatus === 401) await setIntegrationStatus(ws, "wordpress", "error", "WordPress rejected the application password");
    throw ae;
  }
}

export async function testWordPress(c: Record<string, string>, s: Record<string, string>) {
  const base = normalizeUrl(c.url).replace(/\/$/, "");
  await assertPublicUrl(base);
  const { data } = await providerFetch("wordpress", `${base}/wp-json/wp/v2/users/me?context=edit`, { headers: { Authorization: "Basic " + Buffer.from(`${c.username}:${s.app_password}`).toString("base64") } });
  const u = data as { name?: string; roles?: string[]; capabilities?: Record<string, boolean> };
  if (u.capabilities && !u.capabilities.publish_posts) throw new Error(`Connected as ${u.name}, but this user can't publish posts`);
  return `Connected as ${u.name} (${(u.roles || []).join(", ")})`;
}

export async function uploadMediaFromUrl(ws: string, imageUrl: string, alt?: string, title?: string) {
  await assertPublicUrl(normalizeUrl(imageUrl));
  const res = await fetch(imageUrl);
  if (!res.ok) throw new ActionError({ service: "wordpress", message: `Couldn't download image (${res.status}) ${imageUrl}`, httpStatus: res.status, retryable: res.status >= 500, recommendedAction: "Check the image URL is public." });
  const type = res.headers.get("content-type") || "image/jpeg";
  if (!type.startsWith("image/")) throw new ActionError({ service: "wordpress", message: `URL is not an image (${type})`, retryable: false });
  const ext = type.split("/")[1]?.split(";")[0] || "jpg";
  const name = (title || "image").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60) + "." + ext;
  const media = await wp<{ id: number; source_url: string }>(ws, "POST", "/wp-json/wp/v2/media", Buffer.from(await res.arrayBuffer()), { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"` });
  if (alt || title) await wp(ws, "POST", `/wp-json/wp/v2/media/${media.id}`, { alt_text: alt, title }).catch(() => null);
  return media;
}

async function termIds(ws: string, taxonomy: "categories" | "tags", names: string) {
  const out: number[] = [];
  for (const n of names.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (/^\d+$/.test(n)) { out.push(Number(n)); continue; }
    const found = await wp<{ id: number; name: string }[]>(ws, "GET", `/wp-json/wp/v2/${taxonomy}?search=${encodeURIComponent(n)}&per_page=20`);
    const hit = found.find((f) => f.name.toLowerCase() === n.toLowerCase());
    out.push(hit ? hit.id : (await wp<{ id: number }>(ws, "POST", `/wp-json/wp/v2/${taxonomy}`, { name: n })).id);
  }
  return out;
}

export type WpPublish = {
  operation: string; external_id?: string; post_id?: string; title?: string; content?: string; excerpt?: string; status?: string; date?: string;
  categories?: string; tags?: string; featured_image_url?: string; seo_title?: string; seo_description?: string; focus_keyword?: string;
  acf?: Record<string, unknown>; schema?: Record<string, unknown> | null; testMode?: boolean;
};

export async function publishWordPress(ws: string, p: WpPublish) {
  const c = await creds(ws);
  const kind = /page/.test(p.operation) ? "pages" : "posts";
  const sql = db();
  if (p.operation === "upload_media") {
    if (!p.featured_image_url) throw new ActionError({ service: "wordpress", message: "No image URL", retryable: false });
    return { media: await uploadMediaFromUrl(ws, p.featured_image_url, p.seo_title || p.title, p.title) };
  }
  const payload: Record<string, unknown> = {};
  if (p.title) payload.title = p.title;
  if (p.content != null && p.content !== "") payload.content = p.content + (p.schema ? `\n<!-- wp:html --><script type="application/ld+json">${JSON.stringify(p.schema)}</script><!-- /wp:html -->` : "");
  if (p.excerpt) payload.excerpt = p.excerpt;
  let status = p.status || c.config.default_status || "draft";
  if (p.testMode && status !== "draft") status = "draft"; // test runs never publish
  payload.status = status === "future" && !p.date ? "draft" : status;
  if (p.date) payload.date = p.date;
  if (c.config.author_id) payload.author = Number(c.config.author_id);
  const cats = p.categories || (p.operation.startsWith("create") ? c.config.default_category : "");
  if (cats && kind === "posts") payload.categories = await termIds(ws, "categories", cats);
  const tags = p.tags || (p.operation.startsWith("create") ? c.config.default_tags : "");
  if (tags && kind === "posts") payload.tags = await termIds(ws, "tags", tags);
  if (p.seo_title || p.seo_description || p.focus_keyword) payload.meta = { rank_math_title: p.seo_title, rank_math_description: p.seo_description, rank_math_focus_keyword: p.focus_keyword };
  if (p.acf && Object.keys(p.acf).length) payload.acf = p.acf;

  // Duplicate prevention: one post per (site, external_id).
  let targetId = p.post_id ? Number(p.post_id) : null;
  if (p.external_id) {
    const [pub] = await sql`select post_id from wp_publications where workspace_id = ${ws} and site_url = ${c.base} and external_id = ${p.external_id}`;
    if (pub?.post_id && p.operation.startsWith("create")) {
      targetId = Number(pub.post_id);
      return { duplicate: true, id: targetId, message: `Already published for external ID "${p.external_id}" — skipped to avoid a duplicate.` };
    }
    await sql`insert into wp_publications (workspace_id, site_url, external_id, post_type, generated, payload_hash) values (${ws}, ${c.base}, ${p.external_id}, ${kind}, ${sql.json(payload as never)}, ${sha256(JSON.stringify(payload))})
      on conflict (workspace_id, site_url, external_id) do update set generated = excluded.generated, payload_hash = excluded.payload_hash, updated_at = now()`;
  }
  if (p.featured_image_url) {
    const media = await uploadMediaFromUrl(ws, p.featured_image_url, p.seo_title || p.title, p.title);
    payload.featured_media = media.id;
  }
  if (/^update/.test(p.operation) && !targetId) throw new ActionError({ service: "wordpress", message: "Update needs a post/page ID or a previously published external ID", retryable: false });
  try {
    const r = await wp<{ id: number; link: string; status: string; meta?: Record<string, unknown> }>(ws, "POST", targetId ? `/wp-json/wp/v2/${kind}/${targetId}` : `/wp-json/wp/v2/${kind}`, payload);
    if (p.external_id) await sql`update wp_publications set post_id = ${r.id}, link = ${r.link}, status = ${r.status}, error = null, updated_at = now() where workspace_id = ${ws} and site_url = ${c.base} and external_id = ${p.external_id}`;
    const seoIgnored = !!payload.meta && r.meta && !(r.meta as Record<string, unknown>).rank_math_title && !!p.seo_title;
    return { id: r.id, link: r.link, status: r.status, ...(seoIgnored ? { warning: "SEO meta not saved — Rank Math fields aren't exposed to the REST API on this site." } : {}) };
  } catch (e) {
    // Keep the generated data so a retry (or a human) can publish it later.
    if (p.external_id) await sql`update wp_publications set error = ${(e as Error).message}, updated_at = now() where workspace_id = ${ws} and site_url = ${c.base} and external_id = ${p.external_id}`;
    throw e;
  }
}

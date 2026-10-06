// Social publishing via official APIs (Facebook Pages, Instagram Graph,
// LinkedIn Posts) or a user-owned publishing webhook.
import { ActionError, providerFetch } from "./errors";
import { setIntegrationStatus, useIntegration } from "./integrations";
import { integrationGate } from "./ratelimit";
import { assertPublicUrl, normalizeUrl } from "./fetch-page";

const G = "https://graph.facebook.com/v21.0";
export type SocialPost = { platform: string; caption: string; hashtags?: string; media_urls?: string[]; id?: string };

export async function publishSocial(ws: string, p: SocialPost): Promise<{ id: string; url?: string; response: unknown }> {
  const text = [p.caption, p.hashtags].filter(Boolean).join("\n\n");
  const img = p.media_urls?.[0];
  await integrationGate(ws, p.platform);
  const guard = async (provider: "facebook" | "instagram" | "linkedin" | "social_webhook", f: () => Promise<{ id: string; url?: string; response: unknown }>) => {
    try { return await f(); } catch (e) { const ae = e as ActionError; if (ae.httpStatus === 401 || (ae.providerResponse as { error?: { code?: number } })?.error?.code === 190) await setIntegrationStatus(ws, provider, "error", ae.message); throw ae; }
  };
  if (p.platform === "facebook") {
    const i = await useIntegration(ws, "facebook");
    return guard("facebook", async () => {
      const path = img ? `${G}/${i.config.page_id}/photos` : `${G}/${i.config.page_id}/feed`;
      const body = img ? { url: img, caption: text, access_token: i.secrets.page_access_token } : { message: text, access_token: i.secrets.page_access_token };
      const { data } = await providerFetch("facebook", path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = data as { id: string; post_id?: string };
      const id = d.post_id || d.id;
      return { id, url: `https://www.facebook.com/${id}`, response: data };
    });
  }
  if (p.platform === "instagram") {
    const i = await useIntegration(ws, "instagram");
    if (!img) throw new ActionError({ service: "instagram", message: "Instagram posts need an image URL", retryable: false, recommendedAction: "Add a public JPEG image URL." });
    return guard("instagram", async () => {
      const c = await providerFetch("instagram", `${G}/${i.config.ig_user_id}/media`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_url: img, caption: text, access_token: i.secrets.access_token }) });
      const creation = (c.data as { id: string }).id;
      const { data } = await providerFetch("instagram", `${G}/${i.config.ig_user_id}/media_publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creation_id: creation, access_token: i.secrets.access_token }) });
      const id = (data as { id: string }).id;
      const link = await providerFetch("instagram", `${G}/${id}?fields=permalink&access_token=${encodeURIComponent(i.secrets.access_token)}`).then((r) => (r.data as { permalink?: string }).permalink).catch(() => undefined);
      return { id, url: link, response: data };
    });
  }
  if (p.platform === "linkedin") {
    const i = await useIntegration(ws, "linkedin");
    return guard("linkedin", async () => {
      const res = await providerFetch("linkedin", "https://api.linkedin.com/rest/posts", {
        method: "POST", headers: { Authorization: `Bearer ${i.secrets.access_token}`, "Content-Type": "application/json", "LinkedIn-Version": "202409", "X-Restli-Protocol-Version": "2.0.0" },
        body: JSON.stringify({ author: i.config.author_urn, commentary: text, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false }),
      });
      const id = res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id") || "";
      if (!id) throw new ActionError({ service: "linkedin", message: "LinkedIn did not return a post id", providerResponse: res.data, retryable: false });
      return { id, url: `https://www.linkedin.com/feed/update/${id}`, response: res.data };
    });
  }
  if (p.platform === "webhook") {
    const i = await useIntegration(ws, "social_webhook");
    return guard("social_webhook", async () => {
      const url = normalizeUrl(i.config.url);
      await assertPublicUrl(url);
      const { data } = await providerFetch("social_webhook", url, { method: "POST", headers: { "Content-Type": "application/json", ...(i.secrets.auth_header ? { Authorization: i.secrets.auth_header } : {}) }, body: JSON.stringify({ id: p.id, text, caption: p.caption, hashtags: p.hashtags, media_urls: p.media_urls }) });
      const d = (data || {}) as { id?: string; url?: string };
      return { id: d.id || `webhook-${p.id}`, url: d.url, response: data };
    });
  }
  throw new ActionError({ service: "social", message: `Unknown platform ${p.platform}`, retryable: false });
}

export async function testSocial(provider: string, c: Record<string, string>, s: Record<string, string>) {
  if (provider === "facebook") { const { data } = await providerFetch("facebook", `${G}/${c.page_id}?fields=name&access_token=${encodeURIComponent(s.page_access_token)}`); return `Page: ${(data as { name: string }).name}`; }
  if (provider === "instagram") { const { data } = await providerFetch("instagram", `${G}/${c.ig_user_id}?fields=username&access_token=${encodeURIComponent(s.access_token)}`); return `Instagram: @${(data as { username: string }).username}`; }
  if (provider === "linkedin") {
    const m = c.author_urn.match(/^urn:li:organization:(\d+)$/);
    const url = m ? `https://api.linkedin.com/rest/organizations/${m[1]}` : "https://api.linkedin.com/v2/userinfo";
    const { data } = await providerFetch("linkedin", url, { headers: { Authorization: `Bearer ${s.access_token}`, "LinkedIn-Version": "202409" } });
    const d = data as { localizedName?: string; name?: string };
    return `LinkedIn: ${d.localizedName || d.name || c.author_urn}`;
  }
  const url = normalizeUrl(c.url);
  await assertPublicUrl(url);
  const { status } = await providerFetch("social_webhook", url, { method: "POST", headers: { "Content-Type": "application/json", ...(s.auth_header ? { Authorization: s.auth_header } : {}) }, body: JSON.stringify({ test: true }) });
  return `Webhook responded ${status}`;
}

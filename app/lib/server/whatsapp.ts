// WhatsApp Business Cloud API (official). "Sent" = Meta accepted the
// message (returns a wamid); delivered/read come from the webhook.
import { ActionError, providerFetch } from "./errors";
import { setIntegrationStatus, useIntegration } from "./integrations";
import { hmacHex, safeEqual } from "./crypto";
import { integrationGate } from "./ratelimit";

const graph = (v?: string) => `https://graph.facebook.com/${v || "v21.0"}`;

export function normalizePhone(p: string, defaultCc = "91") {
  let d = (p || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = defaultCc + d.slice(1);
  else if (d.length === 10) d = defaultCc + d;
  return /^\d{11,15}$/.test(d) ? d : "";
}

export type WaSend = { to: string; text?: string; template?: { name: string; language?: string; params?: string[] } };

export async function sendWhatsApp(ws: string, m: WaSend) {
  const i = await useIntegration(ws, "whatsapp");
  const to = normalizePhone(m.to);
  if (!to) throw new ActionError({ service: "whatsapp", message: `Invalid phone number: ${m.to}`, retryable: false, code: "invalid_address", recommendedAction: "Fix the phone number (include country code)." });
  if (!m.template?.name && !m.text?.trim()) throw new ActionError({ service: "whatsapp", message: "Nothing to send — set a template or text", retryable: false });
  await integrationGate(ws, "whatsapp");
  const payload = m.template?.name
    ? { messaging_product: "whatsapp", to, type: "template", template: { name: m.template.name, language: { code: m.template.language || "en" }, ...(m.template.params?.length ? { components: [{ type: "body", parameters: m.template.params.map((t) => ({ type: "text", text: t })) }] } : {}) } }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: m.text, preview_url: true } };
  try {
    const { data } = await providerFetch("whatsapp", `${graph(i.config.api_version)}/${i.config.phone_number_id}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${i.secrets.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const id = (data as { messages?: { id: string }[] }).messages?.[0]?.id;
    if (!id) throw new ActionError({ service: "whatsapp", message: "WhatsApp API did not return a message id", providerResponse: data, retryable: false });
    return { messageId: id, to, response: data };
  } catch (e) {
    const ae = e as ActionError;
    const code = (ae.providerResponse as { error?: { code?: number } })?.error?.code;
    if (ae.httpStatus === 401 || code === 190) await setIntegrationStatus(ws, "whatsapp", "error", "Access token rejected");
    if (code === 131047 || code === 470) { ae.retryable = false; ae.recommendedAction = "More than 24h since the customer's last message — use an approved template."; }
    if (code === 132001 || code === 132000) { ae.retryable = false; ae.recommendedAction = "Template not found/params mismatch — select an approved template and matching variables."; }
    if (code === 131026) { ae.retryable = false; ae.code = "invalid_address"; ae.recommendedAction = "This number isn't on WhatsApp."; }
    if (code === 130429 || code === 131056) { ae.retryable = true; ae.retryAfterSec = 60; }
    throw ae;
  }
}

export async function listTemplates(ws: string) {
  const i = await useIntegration(ws, "whatsapp");
  const { data } = await providerFetch("whatsapp", `${graph(i.config.api_version)}/${i.config.business_account_id}/message_templates?fields=name,status,language,category,components&limit=100`, { headers: { Authorization: `Bearer ${i.secrets.access_token}` } });
  return ((data as { data?: { name: string; status: string; language: string; category: string; components: { type: string; text?: string }[] }[] }).data || []).map((t) => ({
    name: t.name, status: t.status, language: t.language, category: t.category,
    body: t.components?.find((c) => c.type === "BODY")?.text || "",
    params: ((t.components?.find((c) => c.type === "BODY")?.text || "").match(/\{\{\d+\}\}/g) || []).length,
  }));
}

export async function testWhatsApp(c: Record<string, string>, s: Record<string, string>) {
  const { data } = await providerFetch("whatsapp", `${graph(c.api_version)}/${c.phone_number_id}?fields=display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${s.access_token}` } });
  const d = data as { display_phone_number?: string; verified_name?: string; quality_rating?: string };
  return `Connected: ${d.verified_name} (${d.display_phone_number}), quality ${d.quality_rating || "n/a"}`;
}

export function verifyMetaSignature(appSecret: string | undefined, raw: string, header: string | null) {
  if (!appSecret) return false;
  const sig = (header || "").replace(/^sha256=/, "");
  return !!sig && safeEqual(sig, hmacHex(appSecret, raw));
}

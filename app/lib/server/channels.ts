// Outbound channels used by tools and the workflow engine: email (Resend),
// WhatsApp Business Cloud API, Google Sheets, WordPress REST, generic HTTP.
// Keys come from the request (browser settings) or Vercel env vars.
import { csvToObjects } from "../csv";
import { assertPublicUrl, normalizeUrl } from "./fetch-page";

const env = process.env;

export type EmailInput = { apiKey?: string; from?: string; to: string | string[]; subject: string; html?: string; text?: string; replyTo?: string };

export async function sendEmail(b: EmailInput): Promise<string> {
  const key = b.apiKey || env.RESEND_API_KEY;
  const from = b.from || env.EMAIL_FROM;
  if (!key) throw new Error("No Resend API key. Add it in ⚙ Settings (free at resend.com) or set RESEND_API_KEY.");
  if (!from) throw new Error('No "From" address. Add a verified sender in ⚙ Settings, e.g. "Designoia <hello@designoia.com>".');
  if (!b.to || (Array.isArray(b.to) && !b.to.length)) throw new Error("Missing recipient email");
  const html = b.html || (b.text || "").split("\n").map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join("<br>");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: b.to, subject: b.subject, html, text: b.text, reply_to: b.replyTo }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || d.error?.message || `Resend error ${r.status}`);
  return d.id;
}

export type WhatsAppInput = { token?: string; phoneId?: string; to: string; text?: string; template?: { name: string; language?: string; params?: string[] } };

export function normalizePhone(p: string) {
  let d = (p || "").replace(/[^\d]/g, "");
  if (d.length === 10) d = "91" + d;
  if (d.length === 11 && d.startsWith("0")) d = "91" + d.slice(1);
  return d;
}

export async function sendWhatsApp(b: WhatsAppInput): Promise<string> {
  const token = b.token || env.WHATSAPP_TOKEN;
  const phoneId = b.phoneId || env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) throw new Error("WhatsApp Cloud API not configured. Add the access token and phone number ID in ⚙ Settings (Meta → WhatsApp → API Setup).");
  const to = normalizePhone(b.to);
  if (to.length < 11) throw new Error(`Invalid phone number: ${b.to}`);
  const payload = b.template?.name
    ? {
        messaging_product: "whatsapp", to, type: "template",
        template: {
          name: b.template.name, language: { code: b.template.language || "en" },
          ...(b.template.params?.length ? { components: [{ type: "body", parameters: b.template.params.map((t) => ({ type: "text", text: t })) }] } : {}),
        },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: b.text || "", preview_url: true } };
  const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || `WhatsApp API error ${r.status}`);
  return d.messages?.[0]?.id || "sent";
}

export function sheetCsvUrl(sheetUrl: string, sheet?: string) {
  const id = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) throw new Error("That doesn't look like a Google Sheets link");
  const gid = sheetUrl.match(/[#&?]gid=(\d+)/)?.[1];
  const q = new URLSearchParams({ tqx: "out:csv" });
  if (sheet) q.set("sheet", sheet); else if (gid) q.set("gid", gid);
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?${q}`;
}

export async function readSheet(sheetUrl: string, sheet?: string) {
  const r = await fetch(sheetCsvUrl(sheetUrl, sheet), { cache: "no-store" });
  const text = await r.text();
  if (!r.ok || /<html/i.test(text.slice(0, 200))) throw new Error('Could not read the sheet. Share it as "Anyone with the link → Viewer" (or publish it) and try again.');
  return csvToObjects(text);
}

export async function sheetsWebhook(webhookUrl: string | undefined, payload: Record<string, unknown>) {
  const url = webhookUrl || env.SHEETS_WEBHOOK_URL;
  if (!url) throw new Error("No Google Sheets Apps Script URL. Set it up in the Sheets Automation tool (one-time, 2 minutes).");
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) throw new Error("The Sheets webhook must be a script.google.com Apps Script URL");
  const { webhookUrl: _omit, ...rest } = payload;
  void _omit;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(rest), redirect: "follow" });
  const text = await r.text();
  try { return JSON.parse(text); } catch { if (!r.ok) throw new Error(`Apps Script error ${r.status}`); return { raw: text.slice(0, 500) }; }
}

export type WPCreds = { wpUrl?: string; wpUser?: string; wpPass?: string };

function wpBase(c: WPCreds) {
  const url = c.wpUrl || env.WP_URL;
  const user = c.wpUser || env.WP_USER;
  const pass = c.wpPass || env.WP_APP_PASSWORD;
  if (!url || !user || !pass) throw new Error("WordPress site not connected. Add URL, username and an Application Password in ⚙ Settings.");
  return { base: normalizeUrl(url).replace(/\/$/, ""), auth: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") };
}

export async function wpRequest(c: WPCreds, method: string, endpoint: string, query?: Record<string, string>, payload?: unknown) {
  const { base, auth } = wpBase(c);
  if (!endpoint?.startsWith("/")) throw new Error("Endpoint must start with /wp-json/…");
  const url = base + endpoint + (query && Object.keys(query).length ? (endpoint.includes("?") ? "&" : "?") + new URLSearchParams(query) : "");
  await assertPublicUrl(url);
  const r = await fetch(url, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(payload || {}),
    cache: "no-store",
  });
  const text = await r.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 1000); }
  if (!r.ok) throw new Error((data as { message?: string })?.message || `WordPress returned ${r.status}`);
  return data;
}

export async function wpUploadData(c: WPCreds, dataUrl: string, filename: string, alt?: string, title?: string) {
  const { base, auth } = wpBase(c);
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error("Invalid image data");
  const r = await fetch(base + "/wp-json/wp/v2/media", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": m[1], "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"` },
    body: Buffer.from(m[2], "base64"),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || `Media upload failed (${r.status})`);
  if (alt || title) await wpRequest(c, "POST", `/wp-json/wp/v2/media/${d.id}`, undefined, { alt_text: alt, title }).catch(() => null);
  return { id: d.id, url: d.source_url };
}

export async function wpUploadFromUrl(c: WPCreds, imageUrl: string, filename?: string, alt?: string) {
  const { base, auth } = wpBase(c);
  await assertPublicUrl(imageUrl);
  const img = await fetch(imageUrl);
  if (!img.ok) throw new Error(`Couldn't download image (${img.status})`);
  const type = img.headers.get("content-type") || "image/jpeg";
  const ext = type.split("/")[1]?.split(";")[0] || "jpg";
  const name = filename || `image-${Date.now()}.${ext}`;
  const r = await fetch(base + "/wp-json/wp/v2/media", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"` },
    body: await img.arrayBuffer(),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || `Media upload failed (${r.status})`);
  if (alt) await wpRequest(c, "POST", `/wp-json/wp/v2/media/${d.id}`, undefined, { alt_text: alt }).catch(() => null);
  return { id: d.id, url: d.source_url };
}

export async function httpCall(url: string, method = "POST", body?: unknown, headers?: Record<string, string>) {
  const u = normalizeUrl(url);
  await assertPublicUrl(u);
  const r = await fetch(u, {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  const text = await r.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 2000); }
  return { status: r.status, ok: r.ok, data };
}

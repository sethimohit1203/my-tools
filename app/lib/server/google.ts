// Google OAuth + Sheets / Drive / Gmail / Search Console / GA4 clients.
import { ActionError, providerFetch } from "./errors";
import { getIntegration, saveIntegration, setIntegrationStatus, useIntegration } from "./integrations";
import { HttpError } from "./db";
import { notify } from "./notify";
import { appUrl } from "./env";

export const GOOGLE_SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];

function client() {
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(503, "Google OAuth isn't set up on the server: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Google Cloud → APIs & Services → Credentials → OAuth client, Web).", "not_configured");
  return { id, secret, redirect: `${appUrl()}/api/integrations/google/callback` };
}

export function googleAuthUrl(state: string) {
  const c = client();
  const q = new URLSearchParams({ client_id: c.id, redirect_uri: c.redirect, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: GOOGLE_SCOPES.join(" "), state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function googleExchange(ws: string, code: string) {
  const c = client();
  const { data } = await providerFetch("google", "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: c.redirect, grant_type: "authorization_code" }),
  });
  const t = data as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
  if (!t.refresh_token) throw new HttpError(400, "Google didn't return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.");
  const me = (await providerFetch("google", "https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } })).data as { email?: string };
  await saveIntegration(ws, "google", { _email: me.email || "", _scopes: t.scope } as Record<string, string>, { status: "connected" });
  await saveSecrets(ws, { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: String(Date.now() + (t.expires_in - 60) * 1000) });
  await setIntegrationStatus(ws, "google", "connected", null);
}

async function saveSecrets(ws: string, s: Record<string, string>) {
  // secrets for OAuth providers are not user-editable fields, so write directly
  const { db } = await import("./db");
  const { encrypt } = await import("./crypto");
  const cur = await getIntegration(ws, "google");
  await db()`update integrations set secrets = ${encrypt({ ...(cur?.secrets || {}), ...s })}, updated_at = now() where workspace_id = ${ws} and provider = 'google'`;
}

export async function googleToken(ws: string): Promise<string> {
  const i = await useIntegration(ws, "google");
  if (i.secrets.access_token && Number(i.secrets.expires_at) > Date.now()) return i.secrets.access_token;
  const c = client();
  try {
    const { data } = await providerFetch("google", "https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: i.secrets.refresh_token, client_id: c.id, client_secret: c.secret, grant_type: "refresh_token" }),
    });
    const t = data as { access_token: string; expires_in: number };
    await saveSecrets(ws, { access_token: t.access_token, expires_at: String(Date.now() + (t.expires_in - 60) * 1000) });
    return t.access_token;
  } catch (e) {
    const ae = e as ActionError;
    if (ae.httpStatus === 400 || ae.httpStatus === 401) {
      await setIntegrationStatus(ws, "google", "expired", "Google authorization was revoked or expired — reconnect.");
      await notify(ws, { type: "integration_failed", severity: "error", title: "Google integration expired", body: "Reconnect Google in Settings → Integrations.", link: "/settings/integrations", dedupeKey: `google-expired-${new Date().toISOString().slice(0, 10)}` });
      throw new ActionError({ service: "google", message: "Google authorization expired", httpStatus: 401, retryable: false, recommendedAction: "Reconnect Google in Settings → Integrations." });
    }
    throw e;
  }
}

export async function gfetch(ws: string, url: string, init: RequestInit = {}) {
  const token = await googleToken(ws);
  return (await providerFetch("google", url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) } })).data;
}

export async function testGoogle(ws: string) {
  const d = (await gfetch(ws, "https://www.googleapis.com/oauth2/v3/userinfo")) as { email?: string };
  return `Connected as ${d.email}`;
}

// ── Sheets ───────────────────────────────────────────────────────────
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function listSpreadsheets(ws: string, search = "") {
  const query = `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${search ? ` and name contains '${search.replace(/'/g, "\\'")}'` : ""}`;
  const d = (await gfetch(ws, `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q: query, pageSize: "50", orderBy: "modifiedTime desc", fields: "files(id,name,modifiedTime)" })}`)) as { files: { id: string; name: string; modifiedTime: string }[] };
  return d.files || [];
}

export async function listWorksheets(ws: string, spreadsheetId: string) {
  const d = (await gfetch(ws, `${SHEETS}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties`)) as { properties: { title: string }; sheets: { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } } }[] };
  return { title: d.properties.title, sheets: d.sheets.map((s) => ({ id: s.properties.sheetId, title: s.properties.title, rows: s.properties.gridProperties.rowCount, cols: s.properties.gridProperties.columnCount })) };
}

export type SheetRow = Record<string, string> & { _row: string };

/** Read rows as objects keyed by header. `offset`/`limit` page through data rows. */
export async function readRows(ws: string, spreadsheetId: string, sheet: string, opts: { offset?: number; limit?: number } = {}): Promise<{ headers: string[]; rows: SheetRow[]; total: number }> {
  const d = (await gfetch(ws, `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${q(sheet)}!A1:ZZ`)}?valueRenderOption=FORMATTED_VALUE`)) as { values?: string[][] };
  const values = d.values || [];
  const headers = (values[0] || []).map((h, i) => String(h || `Column ${i + 1}`).trim());
  const data = values.slice(1);
  const start = opts.offset || 0, end = opts.limit ? start + opts.limit : data.length;
  const rows = data.slice(start, end).map((r, i) => {
    const o: SheetRow = { _row: String(start + i + 2) } as SheetRow;
    headers.forEach((h, j) => { o[h] = r[j] == null ? "" : String(r[j]); });
    return o;
  }).filter((r) => headers.some((h) => r[h] !== ""));
  return { headers, rows, total: data.length };
}

function colLetter(n: number) { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

async function ensureHeaders(ws: string, id: string, sheet: string, keys: string[]) {
  const { headers } = await readRows(ws, id, sheet, { limit: 0 });
  const missing = keys.filter((k) => !headers.includes(k) && !k.startsWith("_"));
  if (missing.length) {
    const all = [...headers, ...missing];
    await gfetch(ws, `${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(sheet)}!A1:${colLetter(all.length - 1)}1`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [all] }) });
    return all;
  }
  return headers;
}

export async function appendRow(ws: string, id: string, sheet: string, row: Record<string, unknown>) {
  const headers = await ensureHeaders(ws, id, sheet, Object.keys(row));
  const d = (await gfetch(ws, `${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(sheet)}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST", body: JSON.stringify({ values: [headers.map((h) => (row[h] == null ? "" : String(row[h])))] }),
  })) as { updates?: { updatedRange?: string } };
  return { range: d.updates?.updatedRange };
}

export async function updateRowByKey(ws: string, id: string, sheet: string, keyColumn: string, row: Record<string, unknown>, upsert = false) {
  const headers = await ensureHeaders(ws, id, sheet, Object.keys(row));
  const keyVal = String(row[keyColumn] ?? row._row ?? "");
  const { rows } = await readRows(ws, id, sheet);
  const hit = keyColumn === "_row" ? rows.find((r) => r._row === keyVal) : rows.find((r) => String(r[keyColumn]) === keyVal);
  if (!hit) {
    if (upsert) return { ...(await appendRow(ws, id, sheet, row)), mode: "appended" };
    throw new ActionError({ service: "google_sheets", message: `No row where ${keyColumn} = "${keyVal}"`, retryable: false, recommendedAction: "Check the key column and value." });
  }
  const merged = headers.map((h) => (row[h] !== undefined ? String(row[h] ?? "") : hit[h] ?? ""));
  const range = `${q(sheet)}!A${hit._row}:${colLetter(headers.length - 1)}${hit._row}`;
  await gfetch(ws, `${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: "PUT", body: JSON.stringify({ values: [merged] }) });
  return { range, mode: "updated" };
}

// ── Gmail ────────────────────────────────────────────────────────────
function b64url(s: string | Buffer) { return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
const encHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);

export type Mail = { to: string; subject: string; html?: string; text?: string; from?: string; headers?: Record<string, string>; attachments?: { filename: string; content: Buffer; contentType: string }[]; threadId?: string };

export function buildMime(m: Mail, from: string) {
  const boundary = `b_${Math.random().toString(36).slice(2)}`;
  const alt = `a_${Math.random().toString(36).slice(2)}`;
  const lines = [`From: ${from}`, `To: ${m.to}`, `Subject: ${encHeader(m.subject)}`, "MIME-Version: 1.0", ...Object.entries(m.headers || {}).map(([k, v]) => `${k}: ${v}`), `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "",
    `--${alt}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(m.text || (m.html || "").replace(/<[^>]+>/g, "")).toString("base64"),
    `--${alt}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(m.html || (m.text || "").replace(/\n/g, "<br>")).toString("base64"), `--${alt}--`];
  for (const a of m.attachments || []) lines.push(`--${boundary}`, `Content-Type: ${a.contentType}; name="${a.filename}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${a.filename}"`, "", a.content.toString("base64"));
  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

export async function sendGmail(ws: string, m: Mail) {
  const i = await useIntegration(ws, "google");
  if (!String(i.config.scopes || "").includes("gmail.send")) throw new ActionError({ service: "gmail", message: "Gmail send permission not granted", retryable: false, recommendedAction: "Reconnect Google and allow Gmail access." });
  const from = m.from || i.config.email;
  const d = (await gfetch(ws, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw: b64url(buildMime(m, from)), ...(m.threadId ? { threadId: m.threadId } : {}) }) })) as { id: string; threadId: string };
  return { id: d.id, threadId: d.threadId, from };
}

export async function gmailSearch(ws: string, query: string, max = 50) {
  const d = (await gfetch(ws, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: query, maxResults: String(max) })}`)) as { messages?: { id: string; threadId: string }[] };
  return d.messages || [];
}

export async function gmailMessage(ws: string, id: string) {
  return (await gfetch(ws, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)) as { id: string; threadId: string; snippet: string; internalDate: string; payload: { headers: { name: string; value: string }[] } };
}

// ── Search Console & GA4 ─────────────────────────────────────────────
export async function searchConsole(ws: string, siteUrl: string, start: string, end: string) {
  const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const totals = (await gfetch(ws, base, { method: "POST", body: JSON.stringify({ startDate: start, endDate: end }) })) as { rows?: { clicks: number; impressions: number; ctr: number; position: number }[] };
  const queries = (await gfetch(ws, base, { method: "POST", body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["query"], rowLimit: 15 }) })) as { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] };
  const pages = (await gfetch(ws, base, { method: "POST", body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["page"], rowLimit: 10 }) })) as { rows?: { keys: string[]; clicks: number; impressions: number }[] };
  const t = totals.rows?.[0];
  return {
    clicks: t?.clicks ?? 0, impressions: t?.impressions ?? 0, ctr: t ? Math.round(t.ctr * 10000) / 100 : 0, avg_position: t ? Math.round(t.position * 10) / 10 : null,
    top_queries: (queries.rows || []).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 })),
    top_pages: (pages.rows || []).map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
  };
}

export async function ga4Report(ws: string, propertyId: string, start: string, end: string) {
  const d = (await gfetch(ws, `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
    method: "POST", body: JSON.stringify({ dateRanges: [{ startDate: start, endDate: end }], metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }, { name: "engagementRate" }, { name: "keyEvents" }] }),
  })) as { rows?: { metricValues: { value: string }[] }[] };
  const v = d.rows?.[0]?.metricValues?.map((x) => Number(x.value)) || [];
  return { sessions: v[0] ?? 0, users: v[1] ?? 0, pageviews: v[2] ?? 0, engagement_rate: v[3] != null ? Math.round(v[3] * 1000) / 10 : null, key_events: v[4] ?? 0 };
}

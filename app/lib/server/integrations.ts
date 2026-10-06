// Integration storage. Non-secret config is stored as JSON; secrets are
// encrypted with ENCRYPTION_KEY and never returned to the browser.
import { db, HttpError } from "./db";
import { decrypt, encrypt } from "./crypto";
import { integrationRequired } from "./errors";

export type Provider =
  | "ai" | "n8n" | "google" | "google_places" | "smtp" | "resend" | "whatsapp" | "wordpress"
  | "facebook" | "instagram" | "linkedin" | "social_webhook";

type FieldDef = { key: string; label: string; secret?: boolean; required?: boolean; placeholder?: string; help?: string; options?: string[] };

export const PROVIDERS: Record<Provider, { label: string; icon: string; group: string; desc: string; oauth?: boolean; fields: FieldDef[] }> = {
  ai: { label: "AI provider", icon: "🤖", group: "AI", desc: "Used by AI Generate/Analyze, AI Processor, reports and campaigns.", fields: [
    { key: "provider", label: "Provider", required: true, options: ["groq", "gemini", "claude", "gpt"] },
    { key: "model", label: "Model (optional)", placeholder: "default for provider" },
    { key: "rate_per_minute", label: "Max requests per minute", placeholder: "30", help: "Match your plan's limit (Groq free ≈ 30/min)." },
    { key: "api_key", label: "API key", secret: true, required: true },
  ] },
  n8n: { label: "n8n", icon: "⚙️", group: "Engine", desc: "Executes runs, schedules, delays and retries. Click “Install engine workflows” after connecting.", fields: [
    { key: "base_url", label: "n8n URL", required: true, placeholder: "https://automation.example.com" },
    { key: "api_key", label: "n8n API key", secret: true, help: "n8n → Settings → n8n API → Create API key. Needed to install/activate workflows." },
    { key: "run_webhook_url", label: "Run Processor webhook URL", placeholder: "filled automatically by Install", help: "Only needed if you imported the engine workflows manually." },
  ] },
  google: { label: "Google (Sheets, Gmail, Search Console, Analytics)", icon: "🟢", group: "Google", oauth: true, desc: "Connect with Google OAuth. Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the server.", fields: [] },
  google_places: { label: "Google Places", icon: "📍", group: "Google", desc: "Optional data source for Maps searches.", fields: [
    { key: "api_key", label: "Places API key", secret: true, required: true },
  ] },
  smtp: { label: "Email — SMTP", icon: "✉️", group: "Email", desc: "Any SMTP server (Zoho, Hostinger, Google Workspace SMTP…). SMTP can't confirm delivery.", fields: [
    { key: "host", label: "Host", required: true }, { key: "port", label: "Port", required: true, placeholder: "465" },
    { key: "secure", label: "TLS", options: ["true", "false"] }, { key: "user", label: "Username", required: true },
    { key: "from", label: "From", required: true, placeholder: "Designoia <hello@designoia.com>" },
    { key: "password", label: "Password", secret: true, required: true },
  ] },
  resend: { label: "Email — Resend", icon: "📨", group: "Email", desc: "Transactional email with delivery & bounce webhooks (point Resend webhooks to /api/webhooks/resend).", fields: [
    { key: "from", label: "From", required: true, placeholder: "Designoia <hello@designoia.com>" },
    { key: "api_key", label: "API key", secret: true, required: true },
    { key: "webhook_secret", label: "Webhook signing secret (whsec_…)", secret: true },
  ] },
  whatsapp: { label: "WhatsApp Business Cloud API", icon: "💬", group: "Messaging", desc: "Official Meta API. Set the webhook to /api/webhooks/whatsapp with the verify token shown after saving.", fields: [
    { key: "phone_number_id", label: "Phone number ID", required: true },
    { key: "business_account_id", label: "WhatsApp Business Account ID", required: true },
    { key: "api_version", label: "API version", placeholder: "v21.0" },
    { key: "access_token", label: "Permanent access token", secret: true, required: true },
    { key: "app_secret", label: "App secret (webhook signature)", secret: true },
  ] },
  wordpress: { label: "WordPress", icon: "🌐", group: "Publishing", desc: "REST API with an Application Password.", fields: [
    { key: "url", label: "Site URL", required: true }, { key: "username", label: "Username", required: true },
    { key: "author_id", label: "Default author ID" }, { key: "default_status", label: "Default status", options: ["draft", "publish", "pending"] },
    { key: "default_category", label: "Default category" }, { key: "default_tags", label: "Default tags (comma)" },
    { key: "app_password", label: "Application password", secret: true, required: true },
  ] },
  facebook: { label: "Facebook Page", icon: "📘", group: "Social", desc: "Graph API page posts.", fields: [
    { key: "page_id", label: "Page ID", required: true }, { key: "page_access_token", label: "Page access token", secret: true, required: true },
  ] },
  instagram: { label: "Instagram (Business)", icon: "📸", group: "Social", desc: "Instagram Graph API content publishing (image posts).", fields: [
    { key: "ig_user_id", label: "Instagram business account ID", required: true }, { key: "access_token", label: "Access token", secret: true, required: true },
  ] },
  linkedin: { label: "LinkedIn", icon: "💼", group: "Social", desc: "Posts API (w_member_social / w_organization_social).", fields: [
    { key: "author_urn", label: "Author URN", required: true, placeholder: "urn:li:organization:123456" },
    { key: "access_token", label: "Access token", secret: true, required: true },
  ] },
  social_webhook: { label: "Social publishing webhook", icon: "🪝", group: "Social", desc: "Publish through Buffer/Make/Zapier/n8n. Must return 2xx and preferably {id, url}.", fields: [
    { key: "url", label: "Webhook URL", required: true }, { key: "auth_header", label: "Authorization header value", secret: true },
  ] },
};

export type IntegrationRow = { id: string; provider: Provider; config: Record<string, string>; secrets: Record<string, string>; status: string; last_tested_at: string | null; last_error: string | null };

export async function getIntegration(ws: string, provider: Provider): Promise<IntegrationRow | null> {
  const [r] = await db()`select * from integrations where workspace_id = ${ws} and provider = ${provider}`;
  if (!r) return null;
  return { id: String(r.id), provider, config: (r.config || {}) as Record<string, string>, secrets: decrypt(r.secrets as string) || {}, status: String(r.status), last_tested_at: r.last_tested_at as string | null, last_error: r.last_error as string | null };
}

/** Get a connected integration or throw "Integration Required". */
export async function useIntegration(ws: string, provider: Provider): Promise<IntegrationRow> {
  const i = await getIntegration(ws, provider);
  if (!i || i.status === "not_configured") throw integrationRequired(provider, PROVIDERS[provider].label);
  if (i.status === "expired") throw integrationRequired(provider, `${PROVIDERS[provider].label} (authorization expired)`);
  return i;
}

export async function saveIntegration(ws: string, provider: Provider, input: Record<string, string>, opts: { status?: string } = {}) {
  const def = PROVIDERS[provider];
  if (!def) throw new HttpError(404, "Unknown integration");
  const existing = await getIntegration(ws, provider);
  const config: Record<string, string> = { ...(existing?.config || {}) };
  const secrets: Record<string, string> = { ...(existing?.secrets || {}) };
  for (const f of def.fields) {
    const v = input[f.key];
    if (v === undefined) continue;
    if (f.secret) { if (v !== "") secrets[f.key] = String(v).trim(); }
    else config[f.key] = String(v).trim();
  }
  for (const [k, v] of Object.entries(input)) if (k.startsWith("_")) config[k.slice(1)] = v; // internal fields
  const missing = def.fields.filter((f) => f.required && !(f.secret ? secrets[f.key] : config[f.key])).map((f) => f.label);
  if (missing.length && !def.oauth) throw new HttpError(400, `Missing: ${missing.join(", ")}`);
  const status = opts.status || "error"; // becomes "connected" only after a successful test
  await db()`
    insert into integrations (workspace_id, provider, config, secrets, status, last_error, updated_at)
    values (${ws}, ${provider}, ${db().json(config)}, ${encrypt(secrets)}, ${status}, ${status === "connected" ? null : "Not tested yet"}, now())
    on conflict (workspace_id, provider) do update set config = excluded.config, secrets = excluded.secrets, status = excluded.status, last_error = excluded.last_error, updated_at = now()`;
}

export async function setIntegrationStatus(ws: string, provider: Provider, status: "connected" | "error" | "expired", error?: string | null) {
  await db()`update integrations set status = ${status}, last_error = ${error ?? null}, last_tested_at = now(), updated_at = now() where workspace_id = ${ws} and provider = ${provider}`;
}

export async function disconnectIntegration(ws: string, provider: Provider) {
  await db()`delete from integrations where workspace_id = ${ws} and provider = ${provider}`;
}

/** Public (browser-safe) view of every integration. */
export async function listIntegrations(ws: string) {
  const rows = await db()`select provider, config, secrets, status, last_tested_at, last_error, updated_at from integrations where workspace_id = ${ws}`;
  const by = new Map(rows.map((r) => [String(r.provider), r]));
  return (Object.keys(PROVIDERS) as Provider[]).map((p) => {
    const r = by.get(p);
    const secrets = r ? decrypt<Record<string, string>>(r.secrets as string) || {} : {};
    return {
      provider: p, ...PROVIDERS[p],
      status: r ? String(r.status) : "not_configured",
      config: r ? (r.config as Record<string, string>) : {},
      secretsSet: Object.fromEntries(PROVIDERS[p].fields.filter((f) => f.secret).map((f) => [f.key, !!secrets[f.key]])),
      lastTestedAt: r?.last_tested_at ?? null, lastError: r?.last_error ?? null,
    };
  });
}

/** Map of logical capability → connected? (email/social are "any of"). */
export async function capabilityStatus(ws: string): Promise<Record<string, boolean>> {
  const rows = await db()`select provider, status, config from integrations where workspace_id = ${ws}`;
  const ok = (p: string) => rows.some((r) => r.provider === p && r.status === "connected");
  const googleScopes = String((rows.find((r) => r.provider === "google")?.config as Record<string, string> | undefined)?.scopes || "");
  return {
    supabase: true,
    n8n: ok("n8n") && !!(rows.find((r) => r.provider === "n8n")?.config as Record<string, string>)?.run_webhook_url,
    ai: ok("ai"),
    google: ok("google"),
    gmail: ok("google") && googleScopes.includes("gmail"),
    google_places: ok("google_places"),
    email: (ok("google") && googleScopes.includes("gmail.send")) || ok("smtp") || ok("resend"),
    whatsapp: ok("whatsapp"),
    wordpress: ok("wordpress"),
    social: ok("facebook") || ok("instagram") || ok("linkedin") || ok("social_webhook"),
    facebook: ok("facebook"), instagram: ok("instagram"), linkedin: ok("linkedin"), social_webhook: ok("social_webhook"),
    smtp: ok("smtp"), resend: ok("resend"),
  };
}

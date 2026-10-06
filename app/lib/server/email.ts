// Email sending via Gmail API, SMTP (nodemailer) or Resend. Returns the
// provider's message id; "sent" means the provider accepted the message —
// delivery is only confirmed by provider webhooks (Resend).
import nodemailer from "nodemailer";
import { ActionError, integrationRequired, providerFetch, toActionError } from "./errors";
import { getIntegration, setIntegrationStatus, useIntegration } from "./integrations";
import { sendGmail, type Mail } from "./google";
import { integrationGate } from "./ratelimit";

export type EmailProvider = "gmail" | "smtp" | "resend";
export type SendResult = { provider: EmailProvider; messageId: string; threadId?: string; from: string };

export async function pickEmailProvider(ws: string, preferred?: string): Promise<EmailProvider> {
  const [g, s, r] = await Promise.all([getIntegration(ws, "google"), getIntegration(ws, "smtp"), getIntegration(ws, "resend")]);
  const ok: Record<EmailProvider, boolean> = {
    gmail: g?.status === "connected" && String(g.config.scopes || "").includes("gmail.send"),
    smtp: s?.status === "connected", resend: r?.status === "connected",
  };
  if (preferred && preferred !== "auto") {
    if (!ok[preferred as EmailProvider]) throw integrationRequired(preferred, preferred === "gmail" ? "Gmail (Google)" : preferred.toUpperCase());
    return preferred as EmailProvider;
  }
  const p = (["gmail", "smtp", "resend"] as EmailProvider[]).find((x) => ok[x]);
  if (!p) throw integrationRequired("email", "an email provider (Gmail, SMTP or Resend)");
  return p;
}

export async function sendEmail(ws: string, m: Mail & { provider?: string }): Promise<SendResult> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to)) throw new ActionError({ service: "email", message: `Invalid email address: ${m.to}`, retryable: false, code: "invalid_address", recommendedAction: "Fix the recipient email." });
  const provider = await pickEmailProvider(ws, m.provider);
  await integrationGate(ws, provider);
  if (provider === "gmail") {
    const r = await sendGmail(ws, m);
    return { provider, messageId: r.id, threadId: r.threadId, from: r.from };
  }
  if (provider === "resend") {
    const i = await useIntegration(ws, "resend");
    const from = m.from || i.config.from;
    const { data } = await providerFetch("resend", "https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${i.secrets.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: m.headers, attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) }),
    }).catch(async (e: ActionError) => { if (e.httpStatus === 401 || e.httpStatus === 403) await setIntegrationStatus(ws, "resend", "error", e.message); throw e; });
    return { provider, messageId: (data as { id: string }).id, from };
  }
  const i = await useIntegration(ws, "smtp");
  const t = smtpTransport(i.config, i.secrets);
  try {
    const info = await t.sendMail({ from: m.from || i.config.from, to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers, attachments: m.attachments });
    if (!info.accepted?.length) throw new ActionError({ service: "smtp", message: `SMTP server rejected ${m.to}: ${info.response}`, retryable: false, providerResponse: info });
    return { provider, messageId: info.messageId, from: m.from || i.config.from };
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; response?: string; message: string };
    if (e instanceof ActionError) throw e;
    if (err.code === "EAUTH") { await setIntegrationStatus(ws, "smtp", "error", err.message); throw new ActionError({ service: "smtp", message: `SMTP authentication failed: ${err.message}`, httpStatus: 401, retryable: false }); }
    if (err.responseCode) throw new ActionError({ service: "smtp", message: `SMTP ${err.responseCode}: ${err.response || err.message}`, retryable: err.responseCode < 500, providerResponse: err.response, code: err.responseCode >= 500 ? "rejected" : undefined });
    throw toActionError(e, "smtp");
  } finally { t.close(); }
}

export function smtpTransport(c: Record<string, string>, s: Record<string, string>) {
  const port = Number(c.port || 465);
  return nodemailer.createTransport({ host: c.host, port, secure: c.secure ? c.secure === "true" : port === 465, auth: { user: c.user, pass: s.password }, connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000 });
}

export async function testSmtp(c: Record<string, string>, s: Record<string, string>) {
  const t = smtpTransport(c, s);
  try { await t.verify(); return `SMTP login OK (${c.host}:${c.port})`; } finally { t.close(); }
}

export async function testResend(s: Record<string, string>) {
  const { data } = await providerFetch("resend", "https://api.resend.com/domains", { headers: { Authorization: `Bearer ${s.api_key}` } });
  const domains = (data as { data?: { name: string; status: string }[] }).data || [];
  return `Resend OK — domains: ${domains.map((d) => `${d.name} (${d.status})`).join(", ") || "none verified yet"}`;
}

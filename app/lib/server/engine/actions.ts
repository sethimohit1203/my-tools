// Action executors for workflow nodes. Each returns its output (saved as
// {{steps.<key>}}) or a control object (__control / __delay / __loop /
// __dryRun / __skipItem). Errors are thrown as ActionError.
import { db } from "../db";
import { ActionError, providerFetch } from "../errors";
import { workspaceAI, aiStructured } from "../ai";
import { appendRow, readRows, updateRowByKey } from "../google";
import { sendEmail } from "../email";
import { sendWhatsApp, normalizePhone } from "../whatsapp";
import { publishWordPress } from "../wordpress";
import { assertPublicUrl, normalizeUrl } from "../fetch-page";
import { auditUrl } from "../audit";
import { mapsSearch } from "../maps";
import { upsertLead, updateLead } from "../leads-db";
import { notify } from "../notify";
import { integrationGate } from "../ratelimit";
import { sha256 } from "../crypto";
import { scoreLead, type AuditSummary } from "../../leads";
import { parseOutputs, type Node, type Rule } from "../../automation/types";
import { evalRules, fieldMap, jsonVal, t, val, type Ctx } from "./template";
import type { ExecEnv } from "./runs";

type Cfg = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

async function suppressed(ws: string, channel: "email" | "whatsapp", address: string) {
  const [r] = await db()`select reason from suppression_list where workspace_id = ${ws} and channel in (${channel}, 'all') and address = ${address} limit 1`;
  return r ? String(r.reason) : null;
}

/** Side-effect idempotency: a step that already succeeded for this item never repeats. */
async function once<T>(env: ExecEnv, scope: string, key: string, f: () => Promise<T>): Promise<T | { duplicate: true; previous: unknown }> {
  const sql = db();
  const [ex] = await sql`select result from idempotency_keys where workspace_id = ${env.ws} and scope = ${scope} and key = ${key}`;
  if (ex) return { duplicate: true, previous: ex.result };
  const out = await f();
  await sql`insert into idempotency_keys (workspace_id, scope, key, run_id, result) values (${env.ws}, ${scope}, ${key}, ${env.run.id}, ${sql.json(out as never)}) on conflict do nothing`;
  return out;
}

export async function runAction(node: Node, ctx: Ctx, env: ExecEnv): Promise<unknown> {
  const c = (node.config || {}) as Cfg;
  const ws = env.ws;
  const stepKey = `${env.run.id}:${env.item.seq}:${node.key}`;
  switch (node.type) {
    case "condition": {
      const r = evalRules(c.rules as Rule[], s(c.combinator), ctx);
      if (r.pass) return { pass: true, rules: r.details };
      return { pass: false, rules: r.details, __control: c.onFalse === "skip_next" ? "skip_next" : "stop" };
    }
    case "delay": {
      const amount = Number(val(c.amount, ctx)) || 0;
      const mult = c.unit === "days" ? 86400 : c.unit === "hours" ? 3600 : 60;
      return { __delay: Math.max(1, amount * mult), waited: `${amount} ${c.unit || "minutes"}` };
    }
    case "loop": {
      const list = val(`{{${s(c.items).replace(/[{}]/g, "")}}}`, ctx);
      if (!Array.isArray(list)) throw new ActionError({ service: "loop", message: `"${s(c.items)}" is not a list`, retryable: false, recommendedAction: "Point Loop at a list, e.g. steps.read.rows" });
      const max = Number(c.max) || 1000;
      return { __loop: list.slice(0, env.testMode ? 1 : max) };
    }
    case "transform": {
      const f = fieldMap(c.fields, ctx);
      for (const [k, v] of Object.entries(f)) if (typeof v === "string" && v.startsWith("=")) f[k] = calc(v.slice(1), k);
      Object.assign(ctx.record, f);
      return f;
    }
    case "ai_generate": {
      const r = await workspaceAI(ws, t(c.prompt, ctx), { maxTokens: Number(c.max_tokens) || 1500 });
      return { text: r.text, usage: r.usage };
    }
    case "ai_analyze": {
      const fields = parseOutputs(s(c.outputs));
      if (!fields.length) throw new ActionError({ service: "ai", message: "No output fields configured", retryable: false });
      const r = await aiStructured(ws, t(c.instruction, ctx), ctx.record, fields);
      Object.assign(ctx.record, r.value);
      return { ...r.value, _usage: r.usage, _repaired: r.repaired };
    }
    case "sheets_read": {
      await integrationGate(ws, "google_sheets");
      const r = await readRows(ws, t(c.spreadsheet_id, ctx), t(c.sheet, ctx), { limit: Number(c.limit) || undefined });
      return { headers: r.headers, rows: r.rows, count: r.rows.length };
    }
    case "sheets_write": {
      const row = fieldMap(c.row, ctx);
      const id = t(c.spreadsheet_id, ctx), sheet = t(c.sheet, ctx), mode = s(c.mode) || "append";
      const expected = { spreadsheet: id, sheet, mode, row };
      if (env.testMode && !env.confirmLive) return { __dryRun: { would: `${mode} row in "${sheet}"`, ...expected } };
      await integrationGate(ws, "google_sheets");
      return once(env, "sheets_write", stepKey, async () => mode === "append" ? appendRow(ws, id, sheet, row) : updateRowByKey(ws, id, sheet, s(c.key_column) || "_row", { ...row, _row: ctx.record._row }, mode === "upsert"));
    }
    case "send_email": {
      const to = t(c.to, ctx).trim().toLowerCase();
      const why = await suppressed(ws, "email", to);
      if (why) return { __skipItem: `${to} is on the suppression list (${why})` };
      const mail = { to, subject: t(c.subject, ctx), text: t(c.body, ctx) };
      if (env.testMode && !env.confirmLive) return { __dryRun: { would: "send email", ...mail } };
      return once(env, "send_email", stepKey, () => sendEmail(ws, mail));
    }
    case "send_whatsapp": {
      const to = normalizePhone(t(c.to, ctx));
      if (!to) throw new ActionError({ service: "whatsapp", message: `Invalid phone: "${t(c.to, ctx)}"`, retryable: false, code: "invalid_address" });
      const why = await suppressed(ws, "whatsapp", to);
      if (why) return { __skipItem: `${to} opted out (${why})` };
      const msg = { to, text: t(c.text, ctx), template: c.template ? { name: t(c.template, ctx), language: t(c.language, ctx) || "en", params: t(c.params, ctx).split(",").map((x) => x.trim()).filter(Boolean) } : undefined };
      if (env.testMode && !env.confirmLive) return { __dryRun: { would: "send WhatsApp", ...msg } };
      return once(env, "send_whatsapp", stepKey, async () => { const r = await sendWhatsApp(ws, msg); return { message_id: r.messageId, to: r.to }; });
    }
    case "wordpress": {
      const p = {
        operation: s(c.operation) || "create_post", external_id: t(c.external_id, ctx) || undefined, post_id: t(c.post_id, ctx) || undefined,
        title: t(c.title, ctx), content: t(c.content, ctx), excerpt: t(c.excerpt, ctx), status: s(c.status) || undefined, date: t(c.date, ctx) || undefined,
        categories: t(c.categories, ctx), tags: t(c.tags, ctx), featured_image_url: t(c.featured_image_url, ctx) || undefined,
        seo_title: t(c.seo_title, ctx), seo_description: t(c.seo_description, ctx), focus_keyword: t(c.focus_keyword, ctx),
        acf: jsonVal(c.acf, ctx) as Record<string, unknown> | undefined, schema: jsonVal(c.schema, ctx) as Record<string, unknown> | undefined,
        testMode: env.testMode,
      };
      if (!p.external_id && p.operation.startsWith("create")) p.external_id = `run:${env.run.id}:${env.item.seq}:${node.key}`; // retries never duplicate
      return publishWordPress(ws, p);
    }
    case "http_request":
    case "webhook": {
      const method = node.type === "webhook" ? "POST" : s(c.method) || "GET";
      const url = normalizeUrl(t(c.url, ctx));
      await assertPublicUrl(url);
      const headers = (jsonVal(c.headers, ctx) as Record<string, string>) || {};
      const body = node.type === "webhook" ? (jsonVal(c.body, ctx) ?? ctx.record) : jsonVal(c.body, ctx);
      if (node.type === "webhook" && env.testMode && !env.confirmLive) return { __dryRun: { would: `POST ${url}`, body } };
      await integrationGate(ws, "http");
      const exec = async () => {
        const r = await providerFetch("http", url, { method, headers: { "Content-Type": "application/json", ...headers }, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body ?? {}), timeoutMs: Number(c.timeout_ms) || 30000 });
        return { status: r.status, data: r.data };
      };
      return method === "GET" ? exec() : once(env, "http", stepKey, exec);
    }
    case "create_lead": {
      const f = fieldMap(c.fields, ctx);
      const input = { ...pickLead(ctx.record), ...f };
      if (!input.source) input.source = env.run.workflow_name ? `workflow: ${env.run.workflow_name}` : "workflow";
      if (env.testMode && !env.confirmLive) return { __dryRun: { would: "create lead", lead: input } };
      const r = await upsertLead(ws, input);
      ctx.record.lead_id = r.id;
      if (r.created && env.run.trigger !== "new_lead") {
        const { emitEvent } = await import("./triggers");
        await emitEvent(ws, "new_lead", { ...input, lead_id: r.id });
      }
      if (r.created && Number(input.lead_score) >= 70) await notify(ws, { type: "lead_hot", severity: "success", title: `🔥 HOT lead: ${input.name}`, body: `Lead score ${input.lead_score}. ${input.recommended_service || ""}`, link: "/crm" });
      return { lead_id: r.id, created: r.created };
    }
    case "update_lead": {
      const f = fieldMap(c.fields, ctx);
      const v = t(c.value, ctx);
      const sql = db();
      const col = s(c.match) || "id";
      const [lead] = col === "email" ? await sql`select id from leads where workspace_id = ${ws} and lower(email) = ${v.toLowerCase()} limit 1`
        : col === "phone" ? await sql`select id from leads where workspace_id = ${ws} and regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g') like ${"%" + v.replace(/\D/g, "").slice(-10)} limit 1`
        : await sql`select id from leads where workspace_id = ${ws} and id::text = ${v} limit 1`;
      if (!lead) throw new ActionError({ service: "crm", message: `No lead with ${col} = ${v}`, retryable: false });
      if (env.testMode && !env.confirmLive) return { __dryRun: { would: "update lead", lead_id: lead.id, fields: f } };
      await updateLead(ws, String(lead.id), f);
      return { lead_id: lead.id, updated: Object.keys(f) };
    }
    case "maps_search": {
      const results = await mapsSearch(ws, { query: t(c.query, ctx), location: t(c.location, ctx), radiusM: Number(c.radius_m) || 3000, limit: Number(c.limit) || 20, source: s(c.source) || "osm" });
      return { count: results.length, results: results.map((r) => ({ name: r.name, category: r.category, address: r.address, phone: r.phone, website: r.website, email: r.email, rating: r.ratingValue ?? null, reviews: r.reviews ?? null, maps_link: r.mapsLink, source_ref: r.id, socials: r.socials || {} })) };
    }
    case "website_audit": {
      const url = t(c.url, ctx).trim();
      if (!url) return { skipped: true, reason: "No website", has_website: false };
      const a = await auditUrl(url, false);
      if (a.error && !a.checks.length) return { has_website: true, reachable: false, error: a.error, score: 0 };
      const summary = { has_website: true, reachable: true, score: a.score, seo: a.categoryScores.seo, mobile: !!a.checks.find((k) => k.id === "viewport")?.pass, https: a.finalUrl.startsWith("https://"), whatsapp: a.hasWhatsApp, contact_form: a.hasContactForm, booking: a.hasBooking, social: a.social, platform: a.platform, emails: a.emails, services: a.services, failed_checks: a.checks.filter((k) => !k.pass).map((k) => k.label) };
      ctx.record.website_score = a.score; ctx.record.seo_score = a.categoryScores.seo;
      if (!ctx.record.email && a.emails[0]) ctx.record.email = a.emails[0];
      return summary;
    }
    case "lead_score": {
      const key = s(c.audit_step) || "audit";
      const a = ctx.steps[key] as Record<string, unknown> | undefined;
      const audit: AuditSummary | undefined = a && a.has_website ? { score: Number(a.score) || 0, https: !!a.https, mobile: !!a.mobile, seo: Number(a.seo) || 0, hasWhatsApp: !!a.whatsapp, hasContactForm: !!a.contact_form, hasBooking: !!a.booking, social: (a.social as Record<string, string>) || {}, platform: s(a.platform), services: (a.services as string[]) || [], emails: (a.emails as string[]) || [], error: a.reachable === false ? s(a.error) || "unreachable" : undefined, checkedAt: new Date().toISOString() } : undefined;
      const r = ctx.record;
      const sc = scoreLead({ id: s(r.source_ref) || "x", name: s(r.name), address: s(r.address), phone: s(r.phone), website: s(r.website), email: s(r.email), rating: "", ratingValue: r.rating == null || r.rating === "" ? undefined : Number(r.rating), reviews: r.reviews == null || r.reviews === "" ? undefined : Number(r.reviews), status: "", category: s(r.category), mapsLink: s(r.maps_link), source: "osm", socials: (r.socials as Record<string, string>) || {} }, "designoia", audit);
      const service = recommendService(sc.opportunities);
      const socialCount = Object.keys({ ...((r.socials as object) || {}), ...(audit?.social || {}) }).length;
      Object.assign(ctx.record, { lead_score: sc.leadScore, temperature: sc.temperature, opportunities: sc.opportunities, recommended_service: service, service, social_score: Math.min(100, socialCount * 25) });
      return { lead_score: sc.leadScore, temperature: sc.temperature, reasons: sc.reasons, opportunities: sc.opportunities, recommended_service: service };
    }
    case "social_publish": {
      const platform = s(c.platform) || "webhook";
      const caption = t(c.caption, ctx), hashtags = t(c.hashtags, ctx), media = t(c.media_url, ctx);
      const hash = sha256(`${platform}|${caption}|${hashtags}|${media}`);
      const auto = c.approval === "auto";
      const sched = t(c.scheduled_for, ctx);
      const status = auto ? (sched ? "scheduled" : "approved") : "awaiting_approval";
      if (env.testMode && !env.confirmLive) return { __dryRun: { would: `queue ${platform} post (${status})`, caption, hashtags, media } };
      const sql = db();
      const [row] = await sql`insert into social_posts (workspace_id, platform, caption, hashtags, media_urls, scheduled_for, status, approval_mode, content_hash, run_id)
        values (${ws}, ${platform}, ${caption}, ${hashtags}, ${media ? [media] : []}, ${sched || null}, ${status}, ${auto ? "auto" : "manual"}, ${hash}, ${env.run.id})
        on conflict (workspace_id, platform, account, content_hash) do nothing returning id`;
      if (!row) return { duplicate: true, message: "Identical post already exists for this platform — not queued again." };
      return { post_id: row.id, status, note: status === "awaiting_approval" ? "Waiting for approval in Social Media Automation" : "Will be published by the scheduler" };
    }
    case "generate_pdf": {
      const { makeDocumentPdf, storeDocument } = await import("../documents");
      const title = t(c.title, ctx), bodyText = t(c.body, ctx);
      const name = (t(c.filename, ctx) || title).replace(/[^\w-]+/g, "-").slice(0, 80) || "document";
      const pdf = await makeDocumentPdf(title, bodyText, s(c.layout) === "certificate" ? "certificate" : "document");
      const stored = await storeDocument(ws, `${env.run.id}/${env.item.seq}-${name}.pdf`, pdf);
      return { filename: `${name}.pdf`, bytes: pdf.length, ...stored };
    }
    case "generate_report": {
      const { queueReport } = await import("../reports");
      const r = await queueReport(ws, t(c.report_id, ctx), { emailTo: t(c.email_to, ctx) || undefined, trigger: "workflow" });
      return r;
    }
    case "notification": {
      const title = t(c.title, ctx);
      if (env.testMode && !env.confirmLive) return { __dryRun: { would: "notify", title } };
      await notify(ws, { type: "workflow", title, body: t(c.body, ctx), severity: (s(c.severity) || "info") as "info", link: `/automation/runs/${env.run.id}`, email: !!c.email });
      return { notified: true };
    }
  }
  throw new ActionError({ service: "engine", message: `Unknown step type ${node.type}`, retryable: false });
}

function pickLead(r: Record<string, unknown>) {
  const keys = ["name", "business", "category", "phone", "email", "website", "address", "city", "rating", "reviews", "lead_score", "website_score", "seo_score", "social_score", "temperature", "recommended_service", "pitch", "opportunities", "source", "source_ref", "maps_link", "profile"];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (r[k] !== undefined && r[k] !== "") out[k] = r[k];
  if (!out.pitch && r.text) out.pitch = r.text;
  return out;
}

/** Designoia service recommendation rules. */
export function recommendService(opps: string[]) {
  const o = opps.join(" | ");
  const list: string[] = [];
  if (/Website development/i.test(o)) list.push("Website Development");
  else if (/redesign|improvement/i.test(o)) list.push("Website Redesign");
  if (/SEO/i.test(o)) list.push("SEO");
  if (/Social/i.test(o)) list.push("Social Media Management");
  if (/Ads|Lead capture/i.test(o)) list.push("Ads Management");
  if (/WhatsApp/i.test(o)) list.push("WhatsApp Automation");
  if (list.length >= 3) return `Growth bundle: ${list.join(" + ")}`;
  return list.join(" + ") || "SEO";
}

/** Safe arithmetic for Transform ("=" prefix): numbers, + - * / % ( ) and round(). */
export function calc(expr: string, field: string): number {
  const e = expr.replace(/round\(/g, "R(").replace(/\s+/g, "");
  if (!/^[\d.+\-*/%()R,]*$/.test(e)) throw new ActionError({ service: "transform", message: `"${field}": only numbers and + - * / % ( ) round() are allowed (got "${expr}")`, retryable: false });
  let i = 0;
  const peek = () => e[i];
  const num = (): number => {
    if (peek() === "(") { i++; const v = add(); i++; return v; }
    if (peek() === "R") { i += 2; const v = add(); let d = 0; if (peek() === ",") { i++; d = add(); } i++; const f = 10 ** d; return Math.round(v * f) / f; }
    if (peek() === "-") { i++; return -num(); }
    const m = e.slice(i).match(/^\d+(\.\d+)?/);
    if (!m) throw new ActionError({ service: "transform", message: `"${field}": invalid expression "${expr}" (a value may be empty)`, retryable: false });
    i += m[0].length; return Number(m[0]);
  };
  const mul = (): number => { let v = num(); while (["*", "/", "%"].includes(peek())) { const op = e[i++]; const r = num(); v = op === "*" ? v * r : op === "/" ? (r === 0 ? NaN : v / r) : v % r; } return v; };
  const add = (): number => { let v = mul(); while (["+", "-"].includes(peek())) { const op = e[i++]; const r = mul(); v = op === "+" ? v + r : v - r; } return v; };
  const v = add();
  if (i !== e.length || !Number.isFinite(v)) throw new ActionError({ service: "transform", message: `"${field}": could not calculate "${expr}"`, retryable: false });
  return Math.round(v * 100) / 100;
}

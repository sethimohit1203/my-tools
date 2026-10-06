// Report automation: Collect → Validate → Calculate → AI analysis (only on
// supplied data, numbers verified) → PDF → Store → Email.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { db, HttpError } from "./db";
import { sha256 } from "./crypto";
import { auditUrl } from "./audit";
import { getIntegration } from "./integrations";
import { ga4Report, searchConsole } from "./google";
import { mapsSearch } from "./maps";
import { aiStructured } from "./ai";
import { sendEmail } from "./email";
import { notify } from "./notify";
import { campaignStats } from "./campaigns";
import { createRun, dispatchRun, registerKind, type ExecEnv } from "./engine/runs";

export const REPORT_TYPES = {
  seo_monthly: "SEO Monthly Report", website_audit: "Website Audit", local_seo: "Local SEO Report",
  lead: "Lead Report", campaign: "Campaign Report", competitor: "Competitor Report",
} as const;

type Cfg = { client?: string; url?: string; email?: string; keywords?: string; gsc_site?: string; ga_property?: string; query?: string; location?: string; competitors?: string; campaign_id?: string; manual_data?: string; period?: string };

function period(p?: string) {
  const now = new Date();
  if (p === "last_30_days") { const end = new Date(now.getTime() - 2 * 86400000); const start = new Date(end.getTime() - 29 * 86400000); return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }; }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function collect(ws: string, type: string, cfg: Cfg, per: { start: string; end: string }) {
  const data: Record<string, unknown> = { report_type: type, client: cfg.client || "", period: per };
  const warnings: string[] = [];
  const sources: string[] = [];
  const needUrl = ["seo_monthly", "website_audit"].includes(type);
  if (needUrl) {
    if (!cfg.url) throw new HttpError(400, "This report needs the client's website URL");
    const a = await auditUrl(cfg.url, true);
    if (a.error && !a.checks.length) warnings.push(`Website could not be loaded: ${a.error}`);
    else {
      sources.push("Website Analyzer");
      data.website = { url: a.finalUrl, score: a.score, category_scores: a.categoryScores, http_status: a.status, response_seconds: Math.round(a.ms / 100) / 10, page_kb: Math.round(a.bytes / 1024), title: a.title, meta_description: a.metaDescription, h1: a.h1, words: a.wordCount, images: a.images, images_missing_alt: a.imagesMissingAlt, internal_links: a.internalLinks, schema: a.schemaTypes, robots_txt: a.robotsTxt, sitemap: a.sitemap, broken_links: a.brokenLinks?.length ?? null, whatsapp: a.hasWhatsApp, contact_form: a.hasContactForm, platform: a.platform, failed_checks: a.checks.filter((c) => !c.pass).map((c) => ({ check: c.label, detail: c.detail || "", fix: c.tip })), passed_checks: a.checks.filter((c) => c.pass).map((c) => c.label) };
    }
  }
  if (type === "seo_monthly") {
    const g = await getIntegration(ws, "google");
    const googleOk = g?.status === "connected";
    if (cfg.gsc_site) {
      if (!googleOk) warnings.push("Search Console not included: Google integration not connected");
      else try { data.search_console = await searchConsole(ws, cfg.gsc_site, per.start, per.end); sources.push("Google Search Console"); } catch (e) { warnings.push(`Search Console error: ${(e as Error).message}`); }
    } else warnings.push("Search Console not configured for this report (no clicks/impressions data)");
    if (cfg.ga_property) {
      if (!googleOk) warnings.push("Google Analytics not included: Google integration not connected");
      else try { data.analytics = await ga4Report(ws, cfg.ga_property, per.start, per.end); sources.push("Google Analytics 4"); } catch (e) { warnings.push(`Google Analytics error: ${(e as Error).message}`); }
    } else warnings.push("Google Analytics not configured for this report (no traffic data)");
  }
  if (type === "local_seo" || type === "competitor") {
    if (!cfg.query || !cfg.location) throw new HttpError(400, "This report needs a business keyword and a location");
    const src = (await getIntegration(ws, "google_places"))?.status === "connected" ? "google" : "osm";
    const results = await mapsSearch(ws, { query: cfg.query, location: cfg.location, limit: 40, radiusM: 10000, source: src });
    sources.push(src === "google" ? "Google Places" : "OpenStreetMap");
    const rated = results.filter((r) => r.ratingValue);
    data.market = {
      keyword: cfg.query, location: cfg.location, source: src, businesses: results.length,
      with_website: results.filter((r) => r.website).length, without_website: results.filter((r) => !r.website).length,
      average_rating: rated.length ? Math.round((rated.reduce((s, r) => s + (r.ratingValue || 0), 0) / rated.length) * 100) / 100 : null,
      average_reviews: rated.length ? Math.round(rated.reduce((s, r) => s + (r.reviews || 0), 0) / rated.length) : null,
      top: results.slice().sort((a, b) => (b.ratingValue || 0) * Math.log10((b.reviews || 0) + 10) - (a.ratingValue || 0) * Math.log10((a.reviews || 0) + 10)).slice(0, 10).map((r) => ({ name: r.name, rating: r.ratingValue ?? null, reviews: r.reviews ?? null, website: r.website || null })),
    };
    if (src === "osm") warnings.push("Ratings/reviews unavailable from OpenStreetMap — connect Google Places for them");
    if (cfg.client) data.client_business = cfg.client;
    const comps = (cfg.competitors || "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean).slice(0, 5);
    if (comps.length) {
      data.competitor_sites = [];
      for (const c of comps) { const a = await auditUrl(c, false); (data.competitor_sites as unknown[]).push({ url: c, score: a.error && !a.checks.length ? null : a.score, error: a.error || null, seo: a.categoryScores?.seo ?? null, words: a.wordCount, schema: a.schemaTypes }); }
      sources.push("Competitor website audits");
    }
  }
  if (type === "lead") {
    const sql = db();
    const [t] = await sql`select count(*)::int as total, count(*) filter (where created_at >= ${per.start}::date and created_at < (${per.end}::date + 1))::int as new_in_period, count(*) filter (where temperature = 'HOT')::int as hot, count(*) filter (where coalesce(website,'') = '')::int as no_website, round(avg(lead_score))::int as avg_score, coalesce(sum(value) filter (where stage not in ('Lost','Do Not Contact')),0)::float as pipeline_value, count(*) filter (where stage = 'Won')::int as won from leads where workspace_id = ${ws}`;
    const stages = await sql`select stage, count(*)::int as n from leads where workspace_id = ${ws} group by stage order by n desc`;
    const sources_ = await sql`select coalesce(source,'unknown') as source, count(*)::int as n from leads where workspace_id = ${ws} group by 1 order by n desc limit 8`;
    data.crm = { ...t, stages: Object.fromEntries(stages.map((s) => [s.stage, s.n])), sources: Object.fromEntries(sources_.map((s) => [s.source, s.n])) };
    sources.push("CRM");
  }
  if (type === "campaign") {
    if (!cfg.campaign_id) throw new HttpError(400, "Choose a campaign");
    const [c] = await db()`select name, channel, status from campaigns where id = ${cfg.campaign_id} and workspace_id = ${ws}`;
    if (!c) throw new HttpError(404, "Campaign not found");
    const s = await campaignStats(ws, cfg.campaign_id);
    const sent = ["sent", "delivered", "read", "replied", "bounced"].reduce((a, k) => a + Number(s.messages[k] || 0), 0);
    data.campaign = { name: c.name, channel: c.channel, status: c.status, messages: s.messages, leads: s.leads, sent, reply_rate_percent: sent ? Math.round((Number(s.leads.replied || 0) / Math.max(1, Object.values(s.leads).reduce((a: number, b) => a + Number(b), 0))) * 1000) / 10 : 0 };
    sources.push("Campaign data");
  }
  if (cfg.manual_data?.trim()) {
    try { data.manual = JSON.parse(cfg.manual_data); sources.push("Manual data"); }
    catch {
      const rows = cfg.manual_data.split("\n").map((l) => l.split(/[:,\t]/).map((x) => x.trim())).filter((r) => r[0] && r[1] != null);
      data.manual = Object.fromEntries(rows.map((r) => [r[0], isNaN(Number(r[1])) ? r[1] : Number(r[1])]));
      sources.push("Manual data");
    }
  }
  if (cfg.keywords) data.target_keywords = cfg.keywords.split(",").map((k) => k.trim()).filter(Boolean);
  data.sources = sources;
  return { data, warnings };
}

const SECTIONS = ["executive_summary", "metrics_commentary", "seo", "technical_seo", "local_seo", "backlinks", "problems", "recommendations", "next_month_plan"] as const;

/** Numbers in the AI text must exist in the data (allowing tiny list counters). */
export function unsupportedNumbers(text: string, data: unknown): string[] {
  const allowed = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "number") { allowed.add(String(v)); allowed.add(String(Math.round(v))); allowed.add(v.toFixed(1)); }
    else if (typeof v === "string") (v.match(/\d+(?:\.\d+)?/g) || []).forEach((n) => allowed.add(n));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(data);
  const found = (text.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w])/g) || []).filter((n) => Number(n) > 12 && !(Number(n) >= 1990 && Number(n) <= 2100));
  return [...new Set(found.filter((n) => !allowed.has(n) && !allowed.has(String(Number(n)))))];
}

async function analyze(ws: string, type: string, data: Record<string, unknown>) {
  const fields = SECTIONS.map((name) => ({ name, type: (["problems", "recommendations", "next_month_plan"].includes(name) ? "array" : "string") as "array" | "string" }));
  const instruction = `You are writing a ${REPORT_TYPES[type as keyof typeof REPORT_TYPES]} for an Indian business owner from a digital agency.
STRICT RULES: Use ONLY numbers and facts present in the JSON data. Never invent, estimate or round metrics that are not in the data. If a section has no supporting data (e.g. no backlink data), write "No data available for this period." Keep each section concise (2-5 sentences); arrays should have 3-7 short items.`;
  const first = await aiStructured(ws, instruction, data, fields);
  let value = first.value;
  let bad = unsupportedNumbers(JSON.stringify(value), data);
  if (bad.length) {
    const second = await aiStructured(ws, `${instruction}\nYour previous draft used numbers that are NOT in the data: ${bad.join(", ")}. Remove or replace them with values from the data.`, data, fields);
    value = second.value;
    bad = unsupportedNumbers(JSON.stringify(value), data);
  }
  return { analysis: value, unsupported: bad };
}

// ── PDF ────────────────────────────────────────────────────────────────
const latin = (s: unknown) => String(s ?? "").replace(/₹/g, "Rs.").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...").replace(/•/g, "-").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");

export async function buildPdf(name: string, agency: string, type: string, data: Record<string, unknown>, analysis: Record<string, unknown> | null, warnings: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  let y = 800;
  const M = 50, W = 495;
  const ensure = (h: number) => { if (y - h < 50) { page = pdf.addPage([595, 842]); y = 800; } };
  const wrap = (text: string, f: PDFFont, size: number) => {
    const lines: string[] = [];
    for (const para of latin(text).split("\n")) {
      let cur = "";
      for (const w of para.split(" ")) { const t = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(t, size) > W && cur) { lines.push(cur); cur = w; } else cur = t; }
      lines.push(cur);
    }
    return lines;
  };
  const text = (s: string, o: { size?: number; f?: PDFFont; color?: [number, number, number]; gap?: number } = {}) => {
    const size = o.size || 10.5, f = o.f || font;
    for (const line of wrap(s, f, size)) { ensure(size + 4); page.drawText(line, { x: M, y, size, font: f, color: rgb(...(o.color || [0.1, 0.1, 0.1])) }); y -= size + 4; }
    y -= o.gap ?? 4;
  };
  const p = data.period as { start: string; end: string };
  text(latin(agency || "Report"), { size: 20, f: bold, color: [0.31, 0.27, 0.9] });
  text(`${REPORT_TYPES[type as keyof typeof REPORT_TYPES]} - ${name}`, { size: 14, f: bold });
  text(`${data.client ? `Client: ${data.client} | ` : ""}Period: ${p.start} to ${p.end} | Generated ${new Date().toISOString().slice(0, 10)}`, { size: 9, color: [0.4, 0.4, 0.4], gap: 10 });
  const heading = (h: string) => { y -= 6; text(h, { size: 13, f: bold, color: [0.31, 0.27, 0.9] }); };
  if (analysis?.executive_summary) { heading("Executive Summary"); text(String(analysis.executive_summary)); }
  heading("Metrics");
  const flat: [string, string][] = [];
  const flatten = (o: unknown, pre = "") => { if (o && typeof o === "object" && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) { if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, `${pre}${k}.`); else if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length < 60)) flat.push([`${pre}${k}`.replace(/_/g, " "), String(v)]); } };
  for (const k of ["website", "search_console", "analytics", "market", "crm", "campaign", "manual"]) if (data[k]) flatten(data[k], `${k.replace(/_/g, " ")}: `);
  for (const [k, v] of flat.slice(0, 60)) { ensure(14); page.drawText(latin(k).slice(0, 60), { x: M, y, size: 9.5, font }); page.drawText(latin(v).slice(0, 40), { x: M + 320, y, size: 9.5, font: bold }); y -= 13; }
  if (analysis) {
    const titles: Record<string, string> = { metrics_commentary: "What the numbers say", seo: "SEO", technical_seo: "Technical SEO", local_seo: "Local SEO", backlinks: "Backlinks", problems: "Problems", recommendations: "Recommendations", next_month_plan: "Next Month Plan" };
    for (const [k, title] of Object.entries(titles)) {
      const v = analysis[k];
      if (!v || (Array.isArray(v) && !v.length)) continue;
      heading(title);
      if (Array.isArray(v)) v.forEach((x) => text(`- ${x}`)); else text(String(v));
    }
  } else {
    const fails = ((data.website as { failed_checks?: { check: string; fix: string }[] })?.failed_checks) || [];
    if (fails.length) { heading("Problems found"); fails.forEach((f) => text(`- ${f.check}: ${f.fix}`)); }
  }
  if (warnings.length) { heading("Data notes"); warnings.forEach((w) => text(`- ${w}`, { size: 9, color: [0.5, 0.35, 0.1] })); }
  return Buffer.from(await pdf.save());
}

// ── Storage (Supabase Storage, private bucket "reports") ───────────────
function storageCfg() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
async function storePdf(path: string, pdf: Buffer) {
  const s = storageCfg();
  if (!s) return null;
  const r = await fetch(`${s.url}/storage/v1/object/reports/${path}`, { method: "POST", headers: { Authorization: `Bearer ${s.key}`, "Content-Type": "application/pdf", "x-upsert": "true" }, body: new Uint8Array(pdf) });
  if (!r.ok) throw new Error(`Storage upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return path;
}
export async function signedPdfUrl(path: string) {
  const s = storageCfg();
  if (!s) return null;
  const r = await fetch(`${s.url}/storage/v1/object/sign/reports/${path}`, { method: "POST", headers: { Authorization: `Bearer ${s.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 600 }) });
  if (!r.ok) return null;
  const d = (await r.json()) as { signedURL?: string; signedUrl?: string };
  return `${s.url}/storage/v1${d.signedURL || d.signedUrl}`;
}

// ── Generation ─────────────────────────────────────────────────────────
export async function queueReport(ws: string, reportId: string, o: { emailTo?: string; force?: boolean; trigger?: string; userId?: string } = {}) {
  const [rep] = await db()`select * from reports where id = ${reportId} and workspace_id = ${ws}`;
  if (!rep) throw new HttpError(404, "Report not found");
  const per = period((rep.config as Cfg).period);
  const [rr] = await db()`insert into report_runs (report_id, workspace_id, status, period_start, period_end) values (${reportId}, ${ws}, 'queued', ${per.start}, ${per.end}) returning id`;
  const { id } = await createRun({ ws, kind: "report", trigger: o.trigger || "manual", workflowName: `Report: ${rep.name}`, records: [{ report_id: reportId, report_run_id: rr.id, email_to: o.emailTo || null, force: !!o.force }], createdBy: o.userId, maxAttempts: 2 });
  await db()`update report_runs set run_id = ${id} where id = ${rr.id}`;
  const d = await dispatchRun(ws, id);
  return { report_run_id: String(rr.id), run_id: id, dispatched: d.dispatched, error: d.error };
}

async function generateItem(env: ExecEnv) {
  const sql = db();
  const i = env.item.input as { report_id: string; report_run_id: string; email_to?: string | null; force?: boolean };
  const [rep] = await sql`select * from reports where id = ${i.report_id} and workspace_id = ${env.ws}`;
  if (!rep) return { __skipItem: "report deleted" };
  const cfg = rep.config as Cfg;
  await sql`update report_runs set status = 'running' where id = ${i.report_run_id}`;
  try {
    const per = period(cfg.period);
    const { data, warnings } = await collect(env.ws, String(rep.type), cfg, per);
    const hash = sha256(JSON.stringify(data));
    const [dup] = i.force ? [] : await sql`select id, analysis, pdf_path from report_runs where report_id = ${i.report_id} and data_hash = ${hash} and status = 'completed' and id <> ${i.report_run_id} order by created_at desc limit 1`;
    let analysis: Record<string, unknown> | null = (dup?.analysis as Record<string, unknown>) || null;
    if (!dup) {
      const ai = await getIntegration(env.ws, "ai");
      if (ai?.status === "connected") {
        const r = await analyze(env.ws, String(rep.type), data);
        analysis = r.analysis;
        if (r.unsupported.length) warnings.push(`AI used numbers not found in the data (${r.unsupported.join(", ")}) — review before sending`);
      } else warnings.push("AI analysis not included: AI integration not configured");
    } else warnings.push("Data unchanged since the last report — reused its analysis (use Regenerate to force a new one)");
    const [ws] = await sql`select name from workspaces where id = ${env.ws}`;
    const pdf = await buildPdf(String(rep.name), String(cfg.client || ws?.name || ""), String(rep.type), data, analysis, warnings);
    let pdfPath: string | null = null;
    try { pdfPath = await storePdf(`${env.ws}/${i.report_id}/${i.report_run_id}.pdf`, pdf); }
    catch (e) { warnings.push(`PDF not stored (${(e as Error).message}); it is regenerated on download`); }
    if (!pdfPath && !storageCfg()) warnings.push("Supabase Storage not configured — PDF is generated on download");
    await sql`update report_runs set status = 'completed', data = ${sql.json(data as never)}, analysis = ${analysis ? sql.json(analysis as never) : null}, data_hash = ${hash}, pdf_path = ${pdfPath}, warnings = ${sql.json(warnings as never)}, completed_at = now() where id = ${i.report_run_id}`;
    let emailed: string | null = null;
    const to = i.email_to || cfg.email;
    if (i.email_to && to && !(env.testMode && !env.confirmLive)) {
      await sendEmail(env.ws, { to, subject: `${REPORT_TYPES[rep.type as keyof typeof REPORT_TYPES]} — ${rep.name} (${per.start} to ${per.end})`, text: `${analysis?.executive_summary || "Please find the report attached."}\n\n— ${ws?.name || ""}`, attachments: [{ filename: `${String(rep.name).replace(/[^\w-]+/g, "-")}.pdf`, content: pdf, contentType: "application/pdf" }] });
      await sql`update report_runs set emailed_to = ${to}, emailed_at = now() where id = ${i.report_run_id}`;
      emailed = to;
    }
    await notify(env.ws, { type: "report_generated", severity: "success", title: `Report ready: ${rep.name}`, body: emailed ? `Emailed to ${emailed}` : undefined, link: `/reports?id=${i.report_id}` });
    return { report_run_id: i.report_run_id, pdf_path: pdfPath, emailed_to: emailed, warnings, sources: data.sources };
  } catch (e) {
    await sql`update report_runs set status = 'failed', error = ${(e as Error).message} where id = ${i.report_run_id}`;
    throw e;
  }
}
registerKind("report", generateItem);

export async function emailReportRun(ws: string, reportRunId: string, to: string) {
  const sql = db();
  const [rr] = await sql`select rr.*, r.name, r.type, r.config from report_runs rr join reports r on r.id = rr.report_id where rr.id = ${reportRunId} and rr.workspace_id = ${ws}`;
  if (!rr || rr.status !== "completed") throw new HttpError(400, "Report run isn't completed");
  const pdf = await pdfFor(ws, reportRunId);
  const [w] = await sql`select name from workspaces where id = ${ws}`;
  const r = await sendEmail(ws, { to, subject: `${REPORT_TYPES[rr.type as keyof typeof REPORT_TYPES]} — ${rr.name}`, text: `${(rr.analysis as { executive_summary?: string })?.executive_summary || "Please find the report attached."}\n\n— ${w?.name || ""}`, attachments: [{ filename: `${String(rr.name).replace(/[^\w-]+/g, "-")}.pdf`, content: pdf, contentType: "application/pdf" }] });
  await sql`update report_runs set emailed_to = ${to}, emailed_at = now() where id = ${reportRunId}`;
  return r;
}

export async function pdfFor(ws: string, reportRunId: string): Promise<Buffer> {
  const [rr] = await db()`select rr.*, r.name, r.type, r.config from report_runs rr join reports r on r.id = rr.report_id where rr.id = ${reportRunId} and rr.workspace_id = ${ws}`;
  if (!rr || rr.status !== "completed") throw new HttpError(404, "No completed report");
  const [w] = await db()`select name from workspaces where id = ${ws}`;
  return buildPdf(String(rr.name), String((rr.config as Cfg).client || w?.name || ""), String(rr.type), rr.data as Record<string, unknown>, rr.analysis as Record<string, unknown> | null, (rr.warnings as string[]) || []);
}

export async function previewReport(ws: string, reportId: string) {
  const [rep] = await db()`select * from reports where id = ${reportId} and workspace_id = ${ws}`;
  if (!rep) throw new HttpError(404, "Report not found");
  return collect(ws, String(rep.type), rep.config as Cfg, period((rep.config as Cfg).period));
}

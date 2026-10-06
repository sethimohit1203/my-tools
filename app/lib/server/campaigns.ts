// Email & WhatsApp campaign engine on the shared leads table.
// Messages are queued with scheduled times that respect the daily limit,
// minimum delay, working hours and allowed days; the ticker hands due
// messages to n8n as runs; provider webhooks/reply checks update statuses.
import { db, HttpError } from "./db";
import { ActionError } from "./errors";
import { getIntegration } from "./integrations";
import { sendEmail, pickEmailProvider } from "./email";
import { normalizePhone, sendWhatsApp } from "./whatsapp";
import { gmailMessage, gmailSearch } from "./google";
import { renderTemplate, escapeHtml } from "../csv";
import { notify } from "./notify";
import { signToken } from "./crypto";
import { appUrl } from "./env";
import { hitRateLimit } from "./ratelimit";
import { logLeadActivity } from "./leads-db";
import { zoned } from "./engine/schedule";
import { createRun, dispatchRun, executeInline, log, registerKind, type ExecEnv } from "./engine/runs";

export type CampaignStep = { day: number; subject?: string; body?: string; template?: string; language?: string; params?: string };
export type CampaignSettings = { daily_limit?: number; min_delay_sec?: number; working_hours?: { start: string; end: string }; days?: number[]; timezone?: string; stop_on_reply?: boolean; provider?: string; recontact_days?: number };
export type AudienceFilter = { stages?: string[]; profile?: string; min_score?: number; max_score?: number; city?: string; category?: string; website?: "any" | "yes" | "no"; lead_ids?: string[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OPT_OUT_RE = /^\s*(stop|unsubscribe|opt[\s-]?out|remove me|band karo|no more messages|cancel)\s*[.!]*\s*$/i;

export function defaults(channel: string, s: CampaignSettings = {}): Required<CampaignSettings> {
  return {
    daily_limit: s.daily_limit ?? (channel === "whatsapp" ? 30 : 50), min_delay_sec: s.min_delay_sec ?? (channel === "whatsapp" ? 120 : 60),
    working_hours: s.working_hours ?? { start: "10:00", end: "19:00" }, days: s.days ?? [1, 2, 3, 4, 5, 6], timezone: s.timezone ?? "Asia/Kolkata",
    stop_on_reply: s.stop_on_reply ?? true, provider: s.provider ?? "auto", recontact_days: s.recontact_days ?? 30,
  };
}

async function getCampaign(ws: string, id: string) {
  const [c] = await db()`select * from campaigns where id = ${id} and workspace_id = ${ws}`;
  if (!c) throw new HttpError(404, "Campaign not found");
  return c as { id: string; workspace_id: string; name: string; channel: "email" | "whatsapp"; mode: "api" | "manual"; status: string; audience_filter: AudienceFilter; steps: CampaignStep[]; settings: CampaignSettings };
}

function leadVars(l: Record<string, unknown>, agency: string) {
  const opps = (l.opportunities as string[]) || [];
  return {
    name: String(l.name || ""), business: String(l.business || l.name || ""), city: String(l.city || ""), category: String(l.category || ""),
    website: String(l.website || ""), service: String(l.recommended_service || opps.slice(0, 2).join(" & ") || "a professional website"),
    pitch: String(l.pitch || ""), rating: l.rating == null ? "" : String(l.rating), lead_score: l.lead_score == null ? "" : String(l.lead_score),
    phone: String(l.phone || ""), email: String(l.email || ""), agency,
  };
}

/** Eligibility preview — every exclusion is counted and explained. */
export async function eligibility(ws: string, id: string) {
  const c = await getCampaign(ws, id);
  const f = c.audience_filter || {};
  const st = defaults(c.channel, c.settings);
  const sql = db();
  const leads = await sql`select * from leads where workspace_id = ${ws}
    ${f.lead_ids?.length ? sql`and id in ${sql(f.lead_ids)}` : sql``}
    ${f.stages?.length ? sql`and stage in ${sql(f.stages)}` : sql``}
    ${f.profile ? sql`and profile = ${f.profile}` : sql``}
    ${f.min_score != null && String(f.min_score) !== "" ? sql`and coalesce(lead_score,0) >= ${Number(f.min_score)}` : sql``}
    ${f.max_score != null && String(f.max_score) !== "" ? sql`and coalesce(lead_score,0) <= ${Number(f.max_score)}` : sql``}
    ${f.city ? sql`and (city ilike ${"%" + f.city + "%"} or address ilike ${"%" + f.city + "%"})` : sql``}
    ${f.category ? sql`and category ilike ${"%" + f.category + "%"}` : sql``}
    ${f.website === "yes" ? sql`and coalesce(website,'') <> ''` : f.website === "no" ? sql`and coalesce(website,'') = ''` : sql``}
    order by lead_score desc nulls last limit 5000`;
  const supp = await sql`select address from suppression_list where workspace_id = ${ws} and channel in (${c.channel}, 'all')`;
  const suppressed = new Set(supp.map((r) => String(r.address)));
  const busy = await sql`select cl.address from campaign_leads cl join campaigns c on c.id = cl.campaign_id where cl.workspace_id = ${ws} and c.status = 'active' and cl.status = 'active' and cl.campaign_id <> ${id}`;
  const inOther = new Set(busy.map((r) => String(r.address)));
  const [agency] = await sql`select name from workspaces where id = ${ws}`;
  const excluded = { no_contact: 0, invalid: 0, opted_out: 0, already_contacted: 0, in_other_campaign: 0, do_not_contact: 0, duplicate: 0 };
  const eligible: { lead_id: string; name: string; address: string; vars: Record<string, string> }[] = [];
  const seen = new Set<string>();
  const cutoff = Date.now() - st.recontact_days * 86400000;
  for (const l of leads) {
    const raw = String((c.channel === "email" ? l.email : l.phone) || "").trim();
    if (!raw) { excluded.no_contact++; continue; }
    const address = c.channel === "email" ? raw.toLowerCase() : normalizePhone(raw);
    if (!address || (c.channel === "email" && !EMAIL_RE.test(address))) { excluded.invalid++; continue; }
    if (l.stage === "Do Not Contact") { excluded.do_not_contact++; continue; }
    if (suppressed.has(address)) { excluded.opted_out++; continue; }
    if (inOther.has(address)) { excluded.in_other_campaign++; continue; }
    if (l.last_contacted_at && new Date(l.last_contacted_at as string).getTime() > cutoff) { excluded.already_contacted++; continue; }
    if (seen.has(address)) { excluded.duplicate++; continue; }
    seen.add(address);
    eligible.push({ lead_id: String(l.id), name: String(l.name), address, vars: leadVars(l, String(agency?.name || "")) });
  }
  const msgs = eligible.length * (c.steps?.length || 1);
  const days = Math.ceil(eligible.length / Math.max(1, st.daily_limit));
  return { total: leads.length, eligible: eligible.length, excluded, messages_to_send: msgs, first_wave_days: days, sample: eligible.slice(0, 5), _eligible: eligible };
}

/** Allocate send times inside working hours/days, spaced and capped per day. */
async function allocate(campaignId: string, st: Required<CampaignSettings>, count: number, notBefore: Date): Promise<Date[]> {
  const sql = db();
  const [last] = await sql`select max(scheduled_for) as t from campaign_messages where campaign_id = ${campaignId} and status in ('queued','sending')`;
  const perDay = await sql`select to_char(scheduled_for at time zone ${st.timezone}, 'YYYY-MM-DD') as d, count(*)::int as n from campaign_messages where campaign_id = ${campaignId} and status not in ('cancelled') group by 1`;
  const used = new Map(perDay.map((r) => [String(r.d), Number(r.n)]));
  let t = new Date(Math.max(notBefore.getTime(), Date.now(), last?.t ? new Date(last.t as string).getTime() + st.min_delay_sec * 1000 : 0));
  const out: Date[] = [];
  const [sh, sm] = st.working_hours.start.split(":").map(Number), [eh, em] = st.working_hours.end.split(":").map(Number);
  let guard = 0;
  while (out.length < count && guard++ < 100000) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: st.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(t);
    const g = Object.fromEntries(p.map((x) => [x.type, x.value]));
    const y = +g.year, m = +g.month, d = +g.day, dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g.weekday);
    const dayKey = `${g.year}-${g.month}-${g.day}`;
    const open = zoned(st.timezone, y, m, d, sh, sm), close = zoned(st.timezone, y, m, d, eh, em);
    const nextDay = () => { const nd = new Date(Date.UTC(y, m - 1, d + 1)); t = zoned(st.timezone, nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate(), sh, sm); };
    if (!st.days.includes(dow) || (used.get(dayKey) || 0) >= st.daily_limit || t >= close) { nextDay(); continue; }
    if (t < open) { t = open; continue; }
    out.push(new Date(t));
    used.set(dayKey, (used.get(dayKey) || 0) + 1);
    t = new Date(t.getTime() + st.min_delay_sec * 1000);
  }
  return out;
}

export async function startCampaign(ws: string, id: string, confirm: boolean) {
  const c = await getCampaign(ws, id);
  if (!confirm) throw new HttpError(400, "Confirmation required: review the eligibility preview and confirm to start.");
  if (!["draft", "paused"].includes(c.status)) throw new HttpError(409, `Campaign is ${c.status}`);
  if (!c.steps?.length) throw new HttpError(400, "Add at least one message to the sequence");
  for (const [i, s] of c.steps.entries()) {
    if (c.channel === "email" && (!s.subject || !s.body)) throw new HttpError(400, `Message ${i + 1}: subject and body are required`);
    if (c.channel === "whatsapp" && c.mode === "api" && i === 0 && !s.template) throw new HttpError(400, "The first WhatsApp message must use an approved template (Meta requires it for business-initiated chats).");
    if (c.channel === "whatsapp" && !s.template && !s.body) throw new HttpError(400, `Message ${i + 1}: choose a template or write text`);
  }
  if (c.mode === "api") {
    if (c.channel === "whatsapp") { const i = await getIntegration(ws, "whatsapp"); if (i?.status !== "connected") throw new HttpError(400, "Integration Required: WhatsApp Business Cloud API (or switch to manual wa.me mode)", "integration_required"); }
    else await pickEmailProvider(ws, defaults("email", c.settings).provider).catch((e: ActionError) => { throw new HttpError(400, e.message, "integration_required"); });
    const n8n = await getIntegration(ws, "n8n");
    if (n8n?.status !== "connected" || !n8n.config.run_webhook_url) throw new HttpError(400, "Integration Required: n8n (sends the queue on schedule)", "integration_required");
  }
  const st = defaults(c.channel, c.settings);
  const sql = db();
  if (c.status === "draft") {
    const el = await eligibility(ws, id);
    if (!el._eligible.length) throw new HttpError(400, "No eligible leads in this audience");
    const times = c.mode === "api" ? await allocate(id, st, el._eligible.length, new Date()) : el._eligible.map(() => new Date());
    for (let i = 0; i < el._eligible.length; i += 200) {
      const chunk = el._eligible.slice(i, i + 200);
      const cls = await sql`insert into campaign_leads ${sql(chunk.map((e) => ({ workspace_id: ws, campaign_id: id, lead_id: e.lead_id, address: e.address, vars: sql.json(e.vars as never), status: "active", current_step: 0 })) as never)} on conflict (campaign_id, lead_id) do nothing returning id, lead_id, address`;
      const byLead = new Map(chunk.map((e, k) => [e.lead_id, times[i + k]]));
      if (cls.length) await sql`insert into campaign_messages ${sql(cls.map((cl) => ({ workspace_id: ws, campaign_id: id, campaign_lead_id: cl.id, lead_id: cl.lead_id, step_index: 0, channel: c.channel, to_address: cl.address, status: "queued", scheduled_for: byLead.get(String(cl.lead_id)) })) as never)} on conflict (campaign_lead_id, step_index) do nothing`;
    }
  }
  await sql`update campaigns set status = 'active', started_at = coalesce(started_at, now()), updated_at = now() where id = ${id}`;
  const [n] = await sql`select count(*)::int as n, min(scheduled_for) as first from campaign_messages where campaign_id = ${id} and status = 'queued'`;
  return { queued: Number(n.n), first_send_at: n.first };
}

export async function pauseCampaign(ws: string, id: string) {
  await getCampaign(ws, id);
  await db()`update campaigns set status = 'paused', updated_at = now() where id = ${id} and status = 'active'`;
  await db()`update campaign_messages set run_id = null where campaign_id = ${id} and status = 'queued'`;
}

export async function cancelCampaign(ws: string, id: string) {
  await getCampaign(ws, id);
  const sql = db();
  await sql`update campaigns set status = 'cancelled', completed_at = now(), updated_at = now() where id = ${id}`;
  await sql`update campaign_messages set status = 'cancelled', updated_at = now() where campaign_id = ${id} and status = 'queued'`;
  await sql`update campaign_leads set status = 'stopped', stop_reason = 'campaign cancelled', updated_at = now() where campaign_id = ${id} and status = 'active'`;
}

function render(c: { channel: string }, step: CampaignStep, vars: Record<string, string>, unsubscribeUrl?: string) {
  const subject = renderTemplate(step.subject || "", vars);
  let body = renderTemplate(step.body || "", vars);
  if (c.channel === "email" && unsubscribeUrl) body += `\n\n—\nDon't want these emails? Unsubscribe: ${unsubscribeUrl}`;
  const params = (step.params || "").split(",").map((x) => renderTemplate(x.trim(), vars)).filter(Boolean);
  return { subject, body, params };
}

/** Send one queued message (run item handler). Real send only — no faking. */
async function sendMessageItem(env: ExecEnv) {
  const sql = db();
  const ws = env.ws;
  if (env.item.input.test) return sendTestItem(env);
  const [m] = await sql`select m.*, cl.status as cl_status, cl.vars, cl.current_step from campaign_messages m join campaign_leads cl on cl.id = m.campaign_lead_id where m.id = ${String(env.item.input.message_id)}`;
  if (!m) return { __skipItem: "message no longer exists" };
  if (m.status !== "queued" && m.status !== "sending") return { __skipItem: `message is ${m.status}` };
  if (m.provider_message_id) return { __skipItem: "already sent (duplicate prevented)" };
  const c = await getCampaign(ws, String(m.campaign_id));
  if (c.status !== "active") { await sql`update campaign_messages set run_id = null, status = 'queued' where id = ${m.id}`; return { __skipItem: `campaign ${c.status} — will send when resumed` }; }
  if (m.cl_status !== "active") { await sql`update campaign_messages set status = 'cancelled', updated_at = now() where id = ${m.id}`; return { __skipItem: `lead ${m.cl_status}` }; }
  const [sup] = await sql`select reason from suppression_list where workspace_id = ${ws} and channel in (${c.channel}, 'all') and address = ${m.to_address}`;
  if (sup) {
    await sql`update campaign_messages set status = 'opted_out', updated_at = now() where id = ${m.id}`;
    await sql`update campaign_leads set status = 'opted_out', stop_reason = ${String(sup.reason)}, updated_at = now() where id = ${m.campaign_lead_id}`;
    return { __skipItem: `${m.to_address} is suppressed (${sup.reason})` };
  }
  const step = c.steps[Number(m.step_index)];
  if (!step) return { __skipItem: "sequence step removed" };
  const unsub = c.channel === "email" ? `${appUrl()}/api/unsubscribe?t=${signToken({ w: ws, c: "email", a: m.to_address, cl: m.campaign_lead_id })}` : undefined;
  const r = render(c, step, m.vars as Record<string, string>, unsub);
  await sql`update campaign_messages set status = 'sending', subject = ${r.subject || null}, body = ${r.body}, template_name = ${step.template || null}, attempts = attempts + 1, run_id = ${env.run.id}, updated_at = now() where id = ${m.id}`;
  const last = env.item.attempts + 1 >= env.item.max_attempts;
  let sentResult: { id: string; thread?: string; provider: string; response?: unknown } | null = null;
  try {
    let res: { id: string; thread?: string; provider: string; response?: unknown };
    if (c.channel === "email") {
      const prev = Number(m.step_index) > 0 ? (await sql`select provider_thread_id from campaign_messages where campaign_lead_id = ${m.campaign_lead_id} and step_index = 0`)[0] : null;
      const s = await sendEmail(ws, { to: m.to_address as string, subject: r.subject, text: r.body, html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${escapeHtml(r.body).replace(/\n/g, "<br>")}</div>`, headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }, provider: defaults("email", c.settings).provider, threadId: (prev?.provider_thread_id as string) || undefined });
      res = { id: s.messageId, thread: s.threadId, provider: s.provider };
    } else {
      const s = await sendWhatsApp(ws, { to: m.to_address as string, text: step.template ? undefined : r.body, template: step.template ? { name: step.template, language: step.language || "en", params: r.params } : undefined });
      res = { id: s.messageId, provider: "whatsapp", response: s.response };
    }
    sentResult = res;
  } catch (e) {
    const ae = e as ActionError;
    if (!ae.retryable || last) {
      await sql`update campaign_messages set status = 'failed', error = ${ae.message}, provider_response = ${ae.providerResponse ? sql.json(ae.providerResponse as never) : null}, updated_at = now() where id = ${m.id}`;
      if (ae.code === "invalid_address") await sql`update campaign_leads set status = 'failed', stop_reason = ${ae.message}, updated_at = now() where id = ${m.campaign_lead_id}`;
    } else await sql`update campaign_messages set status = 'queued', error = ${ae.message}, updated_at = now() where id = ${m.id}`;
    throw e;
  }
  // The provider accepted the message: record it first; follow-up bookkeeping
  // can never turn a confirmed send into "failed" (retries would duplicate it).
  const res = sentResult!;
  await sql`update campaign_messages set status = 'sent', provider = ${res.provider}, provider_message_id = ${res.id}, provider_thread_id = ${res.thread ?? null}, provider_response = ${res.response ? sql.json(res.response as never) : null}, sent_at = now(), error = null, updated_at = now() where id = ${m.id}`;
  try { await afterSent(ws, c, String(m.campaign_lead_id), String(m.lead_id), Number(m.step_index)); }
  catch (e) { await log(ws, env.run.id, `Message ${m.id} sent, but scheduling the next step failed: ${(e as Error).message}`, { level: "error", service: c.channel }); }
  return { message_id: m.id, provider: res.provider, provider_message_id: res.id, to: m.to_address, step: Number(m.step_index) + 1 };
}

async function afterSent(ws: string, c: Awaited<ReturnType<typeof getCampaign>>, clId: string, leadId: string, stepIndex: number) {
  const sql = db();
  const next = c.steps[stepIndex + 1];
  await sql`update leads set last_contacted_at = now(), stage = case when stage in ('New','Qualified') then 'Contacted' else stage end, updated_at = now() where id = ${leadId}`;
  await logLeadActivity(ws, leadId, c.channel === "email" ? "Email" : "WhatsApp", `Campaign "${c.name}" — message ${stepIndex + 1} sent`);
  if (!next) { await sql`update campaign_leads set current_step = ${stepIndex + 1}, last_sent_at = now(), status = 'completed', updated_at = now() where id = ${clId} and status = 'active'`; return; }
  const st = defaults(c.channel, c.settings);
  const base = new Date(Date.now() + Math.max(0, next.day - c.steps[stepIndex].day) * 86400000);
  const [when] = c.mode === "api" ? await allocate(c.id, st, 1, base) : [base];
  const [cl] = await sql`update campaign_leads set current_step = ${stepIndex + 1}, last_sent_at = now(), next_send_at = ${when}, updated_at = now() where id = ${clId} and status = 'active' returning address`;
  if (cl) await sql`insert into campaign_messages (workspace_id, campaign_id, campaign_lead_id, lead_id, step_index, channel, to_address, status, scheduled_for) values (${ws}, ${c.id}, ${clId}, ${leadId}, ${stepIndex + 1}, ${c.channel}, ${cl.address}, 'queued', ${when}) on conflict (campaign_lead_id, step_index) do nothing`;
}

registerKind("campaign", sendMessageItem);

/** Ticker: due queued messages → one run per campaign → n8n. Completes finished campaigns. */
export async function campaignTick() {
  const sql = db();
  const camps = await sql`select distinct c.id, c.workspace_id from campaigns c join campaign_messages m on m.campaign_id = c.id where c.status = 'active' and c.mode = 'api' and m.status = 'queued' and m.run_id is null and m.scheduled_for <= now()`;
  const runs: string[] = [];
  for (const c of camps) {
    const ws = String(c.workspace_id);
    const msgs = await sql`select id from campaign_messages where campaign_id = ${c.id} and status = 'queued' and run_id is null and scheduled_for <= now() order by scheduled_for limit 200`;
    if (!msgs.length) continue;
    const [camp] = await sql`select name from campaigns where id = ${c.id}`;
    const { id } = await createRun({ ws, kind: "campaign", trigger: "campaign_schedule", workflowName: `Campaign: ${camp.name}`, records: msgs.map((m) => ({ message_id: m.id, campaign_id: c.id })), maxAttempts: 3 });
    await sql`update campaign_messages set run_id = ${id} where id in ${sql(msgs.map((m) => String(m.id)))}`;
    await dispatchRun(ws, id);
    runs.push(id);
  }
  // Finish campaigns with nothing left to send.
  const done = await sql`update campaigns c set status = 'completed', completed_at = now(), updated_at = now() where c.status = 'active' and not exists (select 1 from campaign_messages m where m.campaign_id = c.id and m.status in ('queued','sending')) and exists (select 1 from campaign_messages m where m.campaign_id = c.id) returning id, workspace_id, name`;
  for (const d of done) await notify(String(d.workspace_id), { type: "campaign_completed", severity: "success", title: `Campaign "${d.name}" finished`, link: `/outreach?campaign=${d.id}` });
  // Pause campaigns whose integration broke, and tell the user.
  const broken = await sql`select c.id, c.workspace_id, c.name, c.channel from campaigns c where c.status = 'active' and c.mode = 'api' and exists (select 1 from campaign_messages m where m.campaign_id = c.id and m.status = 'failed' and m.updated_at > now() - interval '1 hour' and m.error ilike '%integration%')`;
  for (const b of broken) {
    await sql`update campaigns set status = 'paused', updated_at = now() where id = ${b.id}`;
    await notify(String(b.workspace_id), { type: "campaign_paused", severity: "error", title: `Campaign "${b.name}" paused`, body: `The ${b.channel} integration is failing — fix it in Settings → Integrations, then resume.`, link: "/settings/integrations", email: true });
  }
  return { runs: runs.length, completed: done.length, paused: broken.length };
}

// ── Inbound events: replies, opt-outs, bounces, delivery statuses ─────
async function stopLead(ws: string, address: string, channel: string, status: "replied" | "opted_out" | "unsubscribed" | "bounced", reason: string, eventId?: string) {
  const sql = db();
  const cls = await sql`update campaign_leads set status = ${status}, stop_reason = ${reason}, updated_at = now() where workspace_id = ${ws} and address = ${address} and status in ('active','completed') and campaign_id in (select id from campaigns where channel = ${channel}) returning id, lead_id, campaign_id`;
  for (const cl of cls) {
    await sql`update campaign_messages set status = 'cancelled', updated_at = now() where campaign_lead_id = ${cl.id} and status = 'queued'`;
    if (status === "replied") await sql`update campaign_messages set replied_at = now(), status = 'replied', updated_at = now() where id = (select id from campaign_messages where campaign_lead_id = ${cl.id} and status in ('sent','delivered','read') order by sent_at desc limit 1)`;
    if (status === "bounced") await sql`update campaign_messages set status = 'bounced', updated_at = now() where campaign_lead_id = ${cl.id} and status in ('sent','delivered')`;
    const stage = status === "replied" ? "Interested" : status === "bounced" ? null : "Do Not Contact";
    if (stage) await sql`update leads set stage = case when stage in ('New','Qualified','Contacted') or ${stage} = 'Do Not Contact' then ${stage} else stage end, updated_at = now() where id = ${cl.lead_id}`;
    await logLeadActivity(ws, String(cl.lead_id), channel === "email" ? "Email" : "WhatsApp", `${status.replace("_", " ")}: ${reason}`);
    const { emitEvent } = await import("./engine/triggers");
    await emitEvent(ws, "campaign_event", { event: status === "unsubscribed" ? "opted_out" : status, address, lead_id: cl.lead_id, campaign_id: cl.campaign_id, reason, event_id: eventId ? `${eventId}:${cl.id}` : undefined }).catch(() => null);
  }
  if (status !== "replied") await sql`insert into suppression_list (workspace_id, channel, address, reason, source) values (${ws}, ${channel}, ${address}, ${status === "bounced" ? "bounced" : status}, ${reason.slice(0, 200)}) on conflict do nothing`;
  if (status === "replied" && cls.length) await notify(ws, { type: "lead_replied", severity: "success", title: `💬 Reply from ${address}`, body: reason.slice(0, 200), link: "/crm" });
  return cls.length;
}

export async function handleWhatsAppWebhook(payload: Record<string, unknown>) {
  const sql = db();
  const out = { statuses: 0, replies: 0, opt_outs: 0 };
  type Change = { value?: { metadata?: { phone_number_id?: string }; statuses?: { id: string; status: string; errors?: { title?: string; code?: number }[] }[]; messages?: { id: string; from: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string } } }[] } };
  for (const entry of (payload.entry as { changes?: Change[] }[]) || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      for (const s of v.statuses || []) {
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 9 };
        const [m] = await sql`select id, status, workspace_id from campaign_messages where provider_message_id = ${s.id}`;
        if (!m) continue;
        const cur = rank[String(m.status)] ?? 0;
        if (s.status === "failed") await sql`update campaign_messages set status = 'failed', error = ${s.errors?.[0]?.title || "Delivery failed"}, updated_at = now() where id = ${m.id}`;
        else if ((rank[s.status] ?? 0) > cur) await sql`update campaign_messages set status = ${s.status}, delivered_at = case when ${s.status} in ('delivered','read') then coalesce(delivered_at, now()) else delivered_at end, read_at = case when ${s.status} = 'read' then now() else read_at end, updated_at = now() where id = ${m.id}`;
        out.statuses++;
      }
      if (!v.messages?.length) continue;
      const pid = v.metadata?.phone_number_id;
      const wss = await sql`select workspace_id from integrations where provider = 'whatsapp' and config->>'phone_number_id' = ${pid ?? ""}`;
      for (const w of wss) {
        for (const msg of v.messages) {
          const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || "";
          const from = normalizePhone(msg.from);
          if (OPT_OUT_RE.test(text)) { out.opt_outs += await stopLead(String(w.workspace_id), from, "whatsapp", "opted_out", `Replied "${text}"`, msg.id); }
          else { out.replies += await stopLead(String(w.workspace_id), from, "whatsapp", "replied", text || `(${msg.type})`, msg.id); }
        }
      }
    }
  }
  return out;
}

export async function handleResendEvent(evt: { type: string; data: { email_id?: string; to?: string[]; bounce?: { message?: string } } }) {
  const sql = db();
  const [m] = await sql`select id, workspace_id, to_address, status from campaign_messages where provider_message_id = ${evt.data.email_id ?? ""}`;
  if (!m) return { matched: false };
  const ws = String(m.workspace_id);
  if (evt.type === "email.delivered" && ["sent", "sending"].includes(String(m.status))) await sql`update campaign_messages set status = 'delivered', delivered_at = now(), updated_at = now() where id = ${m.id}`;
  if (evt.type === "email.bounced") await stopLead(ws, String(m.to_address), "email", "bounced", evt.data.bounce?.message || "Bounced");
  if (evt.type === "email.complained") await stopLead(ws, String(m.to_address), "email", "unsubscribed", "Marked as spam");
  return { matched: true };
}

export async function unsubscribe(ws: string, address: string, campaignLeadId?: string) {
  await stopLead(ws, address.toLowerCase(), "email", "unsubscribed", "Clicked unsubscribe link");
  await db()`insert into suppression_list (workspace_id, channel, address, reason, source) values (${ws}, 'email', ${address.toLowerCase()}, 'unsubscribed', ${campaignLeadId ?? "link"}) on conflict do nothing`;
}

/** Gmail reply + bounce detection (SMTP/Resend can't see replies). */
export async function replyCheckTick() {
  const sql = db();
  const wss = await sql`select distinct m.workspace_id from campaign_messages m where m.provider = 'gmail' and m.sent_at > now() - interval '30 days'`;
  let replies = 0, bounces = 0;
  for (const w of wss) {
    const ws = String(w.workspace_id);
    if (!(await hitRateLimit(`replycheck:${ws}`, 600, 1))) continue;
    const g = await getIntegration(ws, "google");
    if (g?.status !== "connected" || !String(g.config.scopes || "").includes("gmail.readonly")) continue;
    const me = String(g.config.email || "").toLowerCase();
    const sent = await sql`select provider_thread_id, to_address from campaign_messages where workspace_id = ${ws} and provider = 'gmail' and provider_thread_id is not null and status in ('sent','delivered') and sent_at > now() - interval '30 days'`;
    const threads = new Map(sent.map((s) => [String(s.provider_thread_id), String(s.to_address)]));
    try {
      for (const msg of await gmailSearch(ws, "in:inbox newer_than:7d -from:me", 100)) {
        const to = threads.get(msg.threadId);
        if (!to) continue;
        const full = await gmailMessage(ws, msg.id);
        const from = (full.payload.headers.find((h) => h.name.toLowerCase() === "from")?.value || "").toLowerCase();
        if (from.includes(me)) continue;
        if (OPT_OUT_RE.test(full.snippet || "")) replies += await stopLead(ws, to, "email", "unsubscribed", `Replied "${full.snippet}"`, msg.id);
        else replies += await stopLead(ws, to, "email", "replied", full.snippet || "Replied", msg.id);
      }
      const addrs = new Set(sent.map((s) => String(s.to_address)));
      for (const msg of await gmailSearch(ws, "from:mailer-daemon newer_than:7d", 30)) {
        const full = await gmailMessage(ws, msg.id);
        const hit = [...addrs].find((a) => (full.snippet || "").toLowerCase().includes(a));
        if (hit) bounces += await stopLead(ws, hit, "email", "bounced", (full.snippet || "").slice(0, 200), msg.id);
      }
    } catch (e) { console.error("[replyCheck]", ws, (e as Error).message); }
  }
  return { replies, bounces };
}

// ── Manual (wa.me / mailto) mode and test sends ───────────────────────
export async function markManualSent(ws: string, messageId: string) {
  const sql = db();
  const [m] = await sql`select * from campaign_messages where id = ${messageId} and workspace_id = ${ws}`;
  if (!m) throw new HttpError(404, "Message not found");
  if (m.status !== "queued") throw new HttpError(409, `Message is already ${m.status}`);
  const c = await getCampaign(ws, String(m.campaign_id));
  await sql`update campaign_messages set status = 'sent', provider = 'manual', sent_at = now(), updated_at = now() where id = ${messageId}`;
  await afterSent(ws, c, String(m.campaign_lead_id), String(m.lead_id), Number(m.step_index));
}

export async function renderManual(ws: string, campaignId: string) {
  const sql = db();
  const c = await getCampaign(ws, campaignId);
  const rows = await sql`select m.id, m.step_index, m.to_address, m.scheduled_for, cl.vars, l.name from campaign_messages m join campaign_leads cl on cl.id = m.campaign_lead_id join leads l on l.id = m.lead_id where m.campaign_id = ${campaignId} and m.status = 'queued' and m.scheduled_for <= now() + interval '12 hours' and cl.status = 'active' order by m.scheduled_for limit 100`;
  return rows.map((r) => { const step = c.steps[Number(r.step_index)] || {}; const x = render(c, step as CampaignStep, r.vars as Record<string, string>); return { id: r.id, name: r.name, to: r.to_address, step: Number(r.step_index) + 1, subject: x.subject, body: x.body, due: r.scheduled_for }; });
}

async function sendTestItem(env: ExecEnv) {
  const i = env.item.input as { campaign_id: string; to: string; step_index?: number };
  const c = await getCampaign(env.ws, i.campaign_id);
  const step = c.steps[i.step_index || 0];
  const [lead] = await db()`select * from leads where workspace_id = ${env.ws} order by lead_score desc nulls last limit 1`;
  const [agency] = await db()`select name from workspaces where id = ${env.ws}`;
  const vars = lead ? leadVars(lead, String(agency?.name || "")) : leadVars({ name: "Sample Business", category: "cafe", city: "Delhi" }, String(agency?.name || ""));
  const r = render(c, step, vars, c.channel === "email" ? `${appUrl()}/api/unsubscribe?t=test` : undefined);
  const expected = { channel: c.channel, to: i.to, subject: r.subject, body: r.body, template: step.template, params: r.params, sample_lead: vars.name };
  if (!env.confirmLive) return { __dryRun: { would: `send test ${c.channel} message`, ...expected } };
  if (c.channel === "email") { const s = await sendEmail(env.ws, { to: i.to, subject: `[TEST] ${r.subject}`, text: r.body, provider: defaults("email", c.settings).provider }); return { ...expected, sent: true, provider: s.provider, provider_message_id: s.messageId }; }
  const s = await sendWhatsApp(env.ws, { to: i.to, text: step.template ? undefined : r.body, template: step.template ? { name: step.template, language: step.language || "en", params: r.params } : undefined });
  return { ...expected, sent: true, provider_message_id: s.messageId };
}

export async function testCampaign(ws: string, id: string, to: string, confirmLive: boolean, userId: string) {
  const c = await getCampaign(ws, id);
  if (!c.steps?.length) throw new HttpError(400, "Add a message first");
  const { id: runId } = await createRun({ ws, kind: "campaign", trigger: "test", workflowName: `Campaign test: ${c.name}`, records: [{ test: true, campaign_id: id, to, step_index: 0 }], isTest: true, createdBy: userId, maxAttempts: 1, input: { confirm_live: confirmLive } });
  await log(ws, runId, confirmLive ? `Sending a real test message to ${to}` : "Dry run — nothing is sent");
  const r = await executeInline(runId);
  return { run_id: runId, ...r };
}

export async function campaignStats(ws: string, id: string) {
  const sql = db();
  const byStatus = await sql`select status, count(*)::int as n from campaign_messages where campaign_id = ${id} and workspace_id = ${ws} group by status`;
  const byStep = await sql`select step_index, status, count(*)::int as n from campaign_messages where campaign_id = ${id} and workspace_id = ${ws} group by step_index, status order by step_index`;
  const leads = await sql`select status, count(*)::int as n from campaign_leads where campaign_id = ${id} and workspace_id = ${ws} group by status`;
  const [next] = await sql`select min(scheduled_for) as t from campaign_messages where campaign_id = ${id} and status = 'queued'`;
  return { messages: Object.fromEntries(byStatus.map((r) => [r.status, r.n])), steps: byStep, leads: Object.fromEntries(leads.map((r) => [r.status, r.n])), next_send_at: next?.t ?? null };
}

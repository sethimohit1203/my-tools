"use client";
// Bulk actions on leads shared by Lead Finder and CRM.
import { readStored, writeStored } from "./store";
import { estimateValue, LEADS_KEY, leadColumns, leadRow, scoreLead, type AuditSummary, type Lead } from "./leads";
import { aiJSON, api, getSettings } from "./settings";

type AuditApi = {
  url: string; error?: string; score: number; categoryScores?: Record<string, number>; checks?: { id: string; pass: boolean }[];
  hasWhatsApp?: boolean; hasContactForm?: boolean; hasBooking?: boolean; social?: Record<string, string>; platform?: string; services?: string[]; emails?: string[]; finalUrl?: string;
};

export function toSummary(a: AuditApi): AuditSummary {
  return {
    score: a.score || 0,
    https: !!a.finalUrl?.startsWith("https://"),
    mobile: !!a.checks?.find((c) => c.id === "viewport")?.pass,
    seo: a.categoryScores?.seo ?? 0,
    hasWhatsApp: !!a.hasWhatsApp, hasContactForm: !!a.hasContactForm, hasBooking: !!a.hasBooking,
    social: a.social || {}, platform: a.platform || "", services: a.services || [], emails: a.emails || [],
    error: a.error, checkedAt: new Date().toISOString(),
  };
}

/** Audit every lead that has a website, 10 per server call. */
export async function auditLeads(leads: Lead[], onProgress?: (done: number, total: number) => void): Promise<Lead[]> {
  const targets = leads.filter((l) => l.website);
  const byId = new Map(leads.map((l) => [l.id, l]));
  for (let i = 0; i < targets.length; i += 10) {
    const batch = targets.slice(i, i + 10);
    onProgress?.(i, targets.length);
    const { results } = await api<{ results: AuditApi[] }>("/api/audit", { urls: batch.map((l) => l.website) });
    batch.forEach((l, j) => {
      const audit = toSummary(results[j]);
      const updated: Lead = { ...l, audit, email: l.email || audit.emails[0] || "" };
      Object.assign(updated, scoreLead(updated, l.profile, audit));
      byId.set(l.id, updated);
    });
  }
  onProgress?.(targets.length, targets.length);
  return leads.map((l) => byId.get(l.id)!);
}

/** Ask AI to classify / estimate / write a pitch for up to 12 leads per call. */
export async function aiAnalyzeLeads(leads: Lead[], onProgress?: (done: number, total: number) => void): Promise<Lead[]> {
  const s = getSettings();
  const byId = new Map(leads.map((l) => [l.id, l]));
  for (let i = 0; i < leads.length; i += 12) {
    onProgress?.(i, leads.length);
    const batch = leads.slice(i, i + 12);
    const compact = batch.map((l) => ({
      id: l.id, name: l.name, category: l.category, profile: l.profile, website: l.website || "none", phone: !!l.phone,
      rating: l.ratingValue ?? null, reviews: l.reviews ?? null, websiteScore: l.audit?.score ?? null, mobile: l.audit?.mobile ?? null,
      whatsapp: l.audit?.hasWhatsApp ?? null, socials: Object.keys({ ...(l.socials || {}), ...(l.audit?.social || {}) }), problems: l.reasons,
    }));
    const data = await aiJSON<{ leads: { id: string; temperature: "HOT" | "WARM" | "COLD"; summary: string; estimate: string; pitch: string; services: string[] }[] }>(
      `You are a sales strategist for ${s.agencyName || "a digital agency"} in India (services: website development, SEO, social media, Google Ads, WhatsApp automation; also COL school partnerships, ClikiXpress supplier sourcing, InnBly hotel booking software depending on "profile").
For each business below, return JSON {"leads":[{"id","temperature":"HOT|WARM|COLD","summary":"2 sentences: online presence + biggest gap","estimate":"realistic INR budget range e.g. ₹25,000–₹60,000","pitch":"one personalised opening line","services":["..."]}]}.
Businesses:\n${JSON.stringify(compact)}`,
      { maxTokens: 4000 },
    );
    for (const r of data.leads || []) {
      const l = byId.get(r.id);
      if (!l) continue;
      byId.set(r.id, {
        ...l, temperature: r.temperature || l.temperature,
        ai: { summary: r.summary, estimate: r.estimate, pitch: r.pitch },
        opportunities: [...new Set([...(r.services || []), ...l.opportunities])],
      });
    }
  }
  onProgress?.(leads.length, leads.length);
  return leads.map((l) => byId.get(l.id)!);
}

/** Merge leads into the CRM (keeps CRM stage/notes for existing ones). */
export function saveToCRM(newLeads: Lead[]): number {
  const crm = readStored<Lead[]>(LEADS_KEY, []);
  const map = new Map(crm.map((l) => [l.id, l]));
  let added = 0;
  for (const l of newLeads) {
    const old = map.get(l.id);
    if (!old) added++;
    map.set(l.id, old ? { ...l, stage: old.stage, notes: old.notes, followUp: old.followUp, value: old.value || l.value, assignedTo: old.assignedTo, history: old.history, createdAt: old.createdAt } : { ...l, value: l.value || estimateValue(l) });
  }
  writeStored(LEADS_KEY, [...map.values()]);
  return added;
}

export async function syncToSheets(leads: Lead[], sheet = "Leads") {
  const s = getSettings();
  const cols = leadColumns();
  return api("/api/sheets", { webhookUrl: s.sheetsWebhook, action: "appendMany", sheet, columns: cols, rows: leads.map((l) => leadRow(l)) });
}

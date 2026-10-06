// Shared CRM leads (Supabase). Used by Lead Finder, CRM, campaigns, workflows.
import { db } from "./db";

export const LEAD_STAGES = ["New", "Qualified", "Contacted", "Interested", "Meeting", "Proposal", "Negotiation", "Won", "Lost", "Do Not Contact"] as const;

const COLS = ["name", "business", "category", "phone", "email", "website", "address", "city", "rating", "reviews", "lead_score", "website_score", "seo_score", "social_score", "temperature", "recommended_service", "pitch", "opportunities", "stage", "owner", "notes", "value", "profile", "source", "source_ref", "maps_link", "lat", "lng", "data", "last_contacted_at", "next_follow_up"] as const;
const NUM = new Set(["rating", "reviews", "lead_score", "website_score", "seo_score", "social_score", "value", "lat", "lng"]);

export function cleanLead(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of COLS) {
    if (!(c in input)) continue;
    let v = input[c];
    if (v === "" || v === undefined) v = null;
    if (v != null && NUM.has(c)) { const n = Number(String(v).replace(/[^\d.-]/g, "")); v = Number.isFinite(n) ? (["reviews", "lead_score", "website_score", "seo_score", "social_score"].includes(c) ? Math.round(n) : n) : null; }
    if (c === "opportunities") v = Array.isArray(v) ? v.map(String) : v ? String(v).split(/[;,]/).map((x) => x.trim()).filter(Boolean) : [];
    if (c === "stage" && v && !LEAD_STAGES.includes(v as never)) v = "New";
    if (c === "data") v = v && typeof v === "object" ? v : {};
    out[c] = v;
  }
  if (!out.name && input.business) out.name = input.business;
  if (!out.name && input.title) out.name = input.title;
  if (typeof out.email === "string") out.email = (out.email as string).trim().toLowerCase();
  return out;
}

/** Insert or (when source_ref matches) update a lead. */
export async function upsertLead(ws: string, input: Record<string, unknown>): Promise<{ id: string; created: boolean }> {
  const l = cleanLead(input);
  if (!l.name) throw new Error("Lead needs a name");
  const sql = db();
  if (l.source_ref) {
    const [ex] = await sql`select id from leads where workspace_id = ${ws} and source_ref = ${l.source_ref as string}`;
    if (ex) {
      const { stage: _s, notes: _n, ...rest } = l; void _s; void _n; // never overwrite CRM-owned fields on re-import
      if (Object.keys(rest).length) await sql`update leads set ${sql(rest as unknown as Record<string, never>)}, updated_at = now() where id = ${ex.id}`;
      return { id: String(ex.id), created: false };
    }
  }
  const [r] = await sql`insert into leads ${sql({ ...l, workspace_id: ws } as unknown as Record<string, never>)} returning id`;
  return { id: String(r.id), created: true };
}

export async function updateLead(ws: string, id: string, patch: Record<string, unknown>) {
  const l = cleanLead(patch);
  if (!Object.keys(l).length) return;
  await db()`update leads set ${db()(l as unknown as Record<string, never>)}, updated_at = now() where id = ${id} and workspace_id = ${ws}`;
}

export async function logLeadActivity(ws: string, leadId: string, channel: string, text: string) {
  await db()`insert into lead_activities (workspace_id, lead_id, channel, text) values (${ws}, ${leadId}, ${channel}, ${text})`;
}

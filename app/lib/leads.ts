// Lead model, scoring profiles and CRM pipeline — shared by Maps, CRM,
// Proposal, Outreach and AI tools.
import type { BizResult } from "./osm";

export type AuditSummary = {
  score: number;
  https: boolean;
  mobile: boolean;
  seo: number;
  hasWhatsApp: boolean;
  hasContactForm: boolean;
  hasBooking: boolean;
  social: Record<string, string>;
  platform: string;
  services: string[];
  emails: string[];
  error?: string;
  checkedAt: string;
};

export const STAGES = ["New", "Contacted", "Interested", "Meeting", "Proposal Sent", "Negotiation", "Won", "Lost"] as const;
export type Stage = (typeof STAGES)[number];

export type Lead = BizResult & {
  profile: ProfileId;
  leadScore: number;
  temperature: "HOT" | "WARM" | "COLD";
  reasons: string[];
  opportunities: string[];
  audit?: AuditSummary;
  ai?: { summary: string; estimate?: string; pitch?: string };
  stage: Stage;
  notes: string;
  followUp: string; // yyyy-mm-dd
  value: number;
  assignedTo: string;
  query: string;
  createdAt: string;
  history?: { at: string; channel: string; text: string }[];
};

export type ProfileId = "designoia" | "col" | "clikixpress" | "innbly";

export const PROFILES: Record<ProfileId, { label: string; icon: string; desc: string; presets: string[]; scoreLabel: string }> = {
  designoia: { label: "Designoia — Website/SEO leads", icon: "💻", desc: "Businesses that need a website, SEO, social or WhatsApp automation.", scoreLabel: "Lead score", presets: ["restaurants", "cafes", "salons", "gyms", "clinics", "dentists", "real estate agents", "coaching centres", "hotels", "boutiques", "wedding venues", "car rental"] },
  col: { label: "COL — School/Institute partners", icon: "🎓", desc: "Schools & institutes for Circle of Learning partnerships, workshops and events.", scoreLabel: "Partnership score", presets: ["schools", "coaching institutes", "tuition centres", "computer institutes", "music schools", "dance academies", "sports academies", "play schools"] },
  clikixpress: { label: "ClikiXpress — Supplier finder", icon: "📦", desc: "Wholesalers and suppliers for the ClikiXpress catalogue.", scoreLabel: "Supplier score", presets: ["mobile accessories wholesalers", "stationery wholesalers", "gift shops", "cosmetics wholesalers", "electronics wholesale", "toy wholesalers", "home products supplier"] },
  innbly: { label: "InnBly — Hotel/PG booking leads", icon: "🏨", desc: "Hotels, PGs and homestays that need a direct booking system.", scoreLabel: "Booking opportunity", presets: ["hotels", "guest houses", "PG", "homestays", "hostels", "resorts"] },
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function scoreLead(r: BizResult, profile: ProfileId, audit?: AuditSummary): Pick<Lead, "leadScore" | "temperature" | "reasons" | "opportunities"> {
  const reasons: string[] = [];
  const opp = new Set<string>();
  let s = 20;
  const hasSite = !!r.website;
  const socials = { ...(r.socials || {}), ...(audit?.social || {}) };
  const socialCount = Object.keys(socials).length;
  const rating = r.ratingValue ?? 0;
  const reviews = r.reviews ?? 0;

  if (profile === "designoia" || profile === "innbly") {
    if (!hasSite) { s += 30; reasons.push("No website (+30)"); opp.add("Website development"); }
    else if (audit && !audit.error) {
      if (audit.score < 50) { s += 20; reasons.push(`Weak website ${audit.score}/100 (+20)`); opp.add("Website redesign"); }
      else if (audit.score < 70) { s += 10; reasons.push(`Average website ${audit.score}/100 (+10)`); opp.add("Website improvements"); }
      if (!audit.mobile) { s += 10; reasons.push("Not mobile friendly (+10)"); }
      if (audit.seo < 60) { s += 8; reasons.push("Poor on-page SEO (+8)"); opp.add("SEO"); }
      if (!audit.hasWhatsApp) { s += 10; reasons.push("No WhatsApp button (+10)"); opp.add("WhatsApp automation"); }
      if (!audit.hasContactForm) { s += 5; reasons.push("No enquiry form (+5)"); opp.add("Lead capture & Ads"); }
    } else if (audit?.error) { s += 20; reasons.push("Website broken/unreachable (+20)"); opp.add("Website redesign"); }
    if (socialCount === 0) { s += 15; reasons.push("No social presence found (+15)"); opp.add("Social media management"); }
    if (r.ratingValue != null && rating < 4) { s += 5; reasons.push(`Low rating ${rating} (+5)`); opp.add("Reputation / review management"); }
    if (r.reviews != null && reviews < 50) { s += 10; reasons.push(`Few reviews (${reviews}) (+10)`); opp.add("Local SEO / GBP optimisation"); }
    if (r.phone) { s += 5; reasons.push("Phone available — easy to contact (+5)"); } else { s -= 10; reasons.push("No phone (-10)"); }
    if (profile === "innbly") {
      if (!audit?.hasBooking) { s += 15; reasons.push("No direct booking system (+15)"); opp.add("InnBly direct booking"); }
      opp.add("InnBly direct booking");
    }
  } else if (profile === "col") {
    if (r.phone) { s += 15; reasons.push("Phone available (+15)"); }
    if (hasSite) { s += 10; reasons.push("Has website — established (+10)"); }
    if (/school|college|academy|institute/i.test(r.category + " " + r.name)) { s += 20; reasons.push("Education institution (+20)"); }
    if (rating >= 4) { s += 10; reasons.push("Well rated (+10)"); }
    if (reviews > 100) { s += 10; reasons.push("Large community (100+ reviews) (+10)"); }
    if (!audit?.social || socialCount < 2) { s += 5; reasons.push("Low social presence — open to activities (+5)"); }
    ["Workshops", "Computer courses", "Science workshops", "Career counselling", "Inter-school events"].forEach((x) => opp.add(x));
  } else if (profile === "clikixpress") {
    if (r.phone) { s += 20; reasons.push("Contactable by phone (+20)"); }
    if (hasSite) { s += 15; reasons.push("Has website / catalogue (+15)"); }
    if (/wholesale|supplier|distribut/i.test(r.name + " " + r.category)) { s += 20; reasons.push("Wholesale / supplier (+20)"); }
    if (rating >= 4) { s += 10; reasons.push("Good reputation (+10)"); }
    if (r.distanceKm != null && r.distanceKm < 5) { s += 10; reasons.push("Nearby (<5 km) (+10)"); }
    opp.add("Supplier partnership");
  }

  const leadScore = clamp(s);
  return { leadScore, temperature: leadScore >= 70 ? "HOT" : leadScore >= 45 ? "WARM" : "COLD", reasons, opportunities: [...opp] };
}

export function toLead(r: BizResult, profile: ProfileId, query: string, existing?: Lead): Lead {
  const scored = scoreLead(r, profile, existing?.audit);
  return {
    stage: "New", notes: "", followUp: "", value: 0, assignedTo: "", createdAt: new Date().toISOString(),
    ...existing, ...r, profile, query: existing?.query || query, ...scored,
  };
}

export function estimateValue(l: Lead): number {
  const o = l.opportunities.join(" ");
  let v = 0;
  if (/Website development|redesign/i.test(o)) v += 30000;
  if (/SEO/i.test(o)) v += 12000;
  if (/Social/i.test(o)) v += 10000;
  if (/WhatsApp/i.test(o)) v += 8000;
  if (/Ads|Lead capture/i.test(o)) v += 10000;
  if (/InnBly/i.test(o)) v += 15000;
  return v;
}

export const LEADS_KEY = "crm-leads";

export function inr(n: number) {
  if (!n) return "₹0";
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return "₹" + n.toLocaleString("en-IN");
}

export function waLink(phone: string, text: string) {
  let digits = (phone || "").replace(/[^\d]/g, "");
  if (digits.length === 10) digits = "91" + digits;
  if (digits.startsWith("0") && digits.length === 11) digits = "91" + digits.slice(1);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function leadColumns() {
  return ["name", "category", "address", "phone", "email", "website", "mapsLink", "rating", "reviews", "websiteScore", "seoScore", "socialScore", "leadScore", "temperature", "stage", "opportunities", "notes", "followUp", "value", "query"];
}

export function leadRow(l: Lead): Record<string, unknown> {
  const socialCount = Object.keys({ ...(l.socials || {}), ...(l.audit?.social || {}) }).length;
  return {
    name: l.name, category: l.category, address: l.address, phone: l.phone, email: l.email || l.audit?.emails?.[0] || "", website: l.website,
    mapsLink: l.mapsLink, rating: l.ratingValue ?? "", reviews: l.reviews ?? "", websiteScore: l.audit?.score ?? "", seoScore: l.audit?.seo ?? "",
    socialScore: Math.min(100, socialCount * 25), leadScore: l.leadScore, temperature: l.temperature, stage: l.stage,
    opportunities: l.opportunities.join("; "), notes: l.notes, followUp: l.followUp, value: l.value, query: l.query,
  };
}

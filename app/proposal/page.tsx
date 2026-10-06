"use client";
import { useEffect, useRef, useState } from "react";
import { Banner, Card, ErrorBox, Field, Shell } from "../lib/ui";
import { useQueryParam, useStored } from "../lib/store";
import { LEADS_KEY, inr, waLink, type Lead } from "../lib/leads";
import { aiText, api, useSettings } from "../lib/settings";
import { escapeHtml } from "../lib/csv";

type Item = { service: string; desc: string; price: number };

const CATALOG: Item[] = [
  { service: "Website Development", desc: "Mobile-first 6–8 page website, contact form, WhatsApp button, Google Map, basic SEO setup", price: 30000 },
  { service: "Website Redesign", desc: "Modern responsive redesign, speed optimisation, SSL, conversion-focused layout", price: 25000 },
  { service: "SEO (monthly)", desc: "On-page SEO, Google Business Profile optimisation, local citations, monthly report", price: 12000 },
  { service: "Social Media Management (monthly)", desc: "12 posts + 4 reels/month for Instagram & Facebook, captions, hashtags", price: 10000 },
  { service: "Google Ads Management (monthly)", desc: "Campaign setup, keyword research, ad copy, conversion tracking (ad spend extra)", price: 8000 },
  { service: "WhatsApp Automation", desc: "WhatsApp Business API setup, auto-replies, lead capture and follow-up flows", price: 8000 },
  { service: "Direct Booking System (InnBly)", desc: "Commission-free booking engine on your own website with payment gateway", price: 15000 },
];

type Draft = { client: string; contact: string; industry: string; problems: string; items: Item[]; intro: string; timeline: string; validity: string; leadId: string };
const EMPTY: Draft = { client: "", contact: "", industry: "", problems: "", items: [], intro: "", timeline: "2–4 weeks", validity: "15 days", leadId: "" };

export default function ProposalPage() {
  const [settings] = useSettings();
  const [leads, setLeads] = useStored<Lead[]>(LEADS_KEY, []);
  const [d, setD] = useStored<Draft>("proposal-draft", EMPTY);
  const leadParam = useQueryParam("lead");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const loaded = useRef("");

  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  function fromLead(id: string) {
    const l = leads.find((x) => x.id === id);
    if (!l) return;
    const problems = [
      !l.website && "No website — customers searching online can't find or trust the business",
      l.audit && l.audit.score < 60 && `Current website scores only ${l.audit.score}/100 (speed, mobile, SEO)`,
      l.audit && !l.audit.mobile && "Website is not mobile-friendly (70%+ of visitors are on phones)",
      l.audit && !l.audit.hasWhatsApp && "No WhatsApp chat button — losing quick enquiries",
      l.audit && !l.audit.hasContactForm && "No enquiry form to capture leads",
      Object.keys({ ...(l.socials || {}), ...(l.audit?.social || {}) }).length === 0 && "Weak social media presence",
      l.reviews != null && l.reviews < 50 && `Only ${l.reviews} Google reviews — competitors have more`,
      l.ratingValue != null && l.ratingValue < 4 && `Google rating ${l.ratingValue}★ needs reputation management`,
    ].filter(Boolean).join("\n");
    const pick = (re: RegExp) => CATALOG.filter((c) => re.test(c.service));
    const items: Item[] = [];
    const o = l.opportunities.join(" ");
    if (!l.website) items.push(...pick(/Website Development/));
    else if (/redesign|improve/i.test(o)) items.push(...pick(/Redesign/));
    if (/SEO/i.test(o)) items.push(...pick(/^SEO/));
    if (/Social/i.test(o)) items.push(...pick(/Social/));
    if (/WhatsApp/i.test(o)) items.push(...pick(/WhatsApp/));
    if (/Ads|Lead capture/i.test(o)) items.push(...pick(/Google Ads/));
    if (/InnBly/i.test(o)) items.push(...pick(/InnBly/));
    set({ client: l.name, contact: [l.phone, l.email].filter(Boolean).join(" · "), industry: l.category, problems, items: items.length ? items : pick(/Website Development|^SEO/), leadId: l.id, intro: "" });
    setEmailTo(l.email || l.audit?.emails?.[0] || "");
  }

  useEffect(() => {
    if (leadParam && loaded.current !== leadParam && leads.length) { loaded.current = leadParam; fromLead(leadParam); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadParam, leads.length]);

  const total = d.items.reduce((s, i) => s + (i.price || 0), 0);

  async function aiWrite() {
    setBusy("AI is writing the proposal…");
    try {
      set({ intro: await aiText(`Write the body of a short, persuasive digital-growth proposal from ${settings.agencyName || "our agency"} to "${d.client}" (${d.industry || "local business"}, India).
Problems found:\n${d.problems}\nServices proposed: ${d.items.map((i) => i.service).join(", ")}.
Write: an "Executive summary" (3–4 sentences), "Our approach" (4–6 bullets mapping each problem to a solution), "Expected results" (3 bullets with realistic outcomes) and "Why ${settings.agencyName || "us"}" (3 bullets). Plain text with headings, no prices, no placeholders.`, { maxTokens: 1500 }) });
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  function html() {
    const rows = d.items.map((i) => `<tr><td style="padding:8px;border-bottom:1px solid #eee"><b>${escapeHtml(i.service)}</b><br><span style="color:#666;font-size:13px">${escapeHtml(i.desc)}</span></td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${inr(i.price)}</td></tr>`).join("");
    return `<div style="font-family:Arial,sans-serif;max-width:680px;color:#111"><h2 style="color:#4f46e5">${escapeHtml(settings.agencyName)} — Digital Growth Proposal</h2><p><b>Prepared for:</b> ${escapeHtml(d.client)}</p>
<h3>Problems found</h3><ul>${d.problems.split("\n").filter(Boolean).map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
${d.intro ? `<div style="white-space:pre-wrap">${escapeHtml(d.intro)}</div>` : ""}
<h3>Recommended services & investment</h3><table style="width:100%;border-collapse:collapse">${rows}<tr><td style="padding:8px"><b>Total</b></td><td style="padding:8px;text-align:right"><b>${inr(total)}</b></td></tr></table>
<p>Timeline: ${escapeHtml(d.timeline)} · Valid for ${escapeHtml(d.validity)} · Prices exclusive of GST.</p>
<p>${escapeHtml([settings.agencyName, settings.agencyPhone, settings.agencyEmail, settings.agencyWebsite].filter(Boolean).join(" · "))}</p></div>`;
  }

  function markSent(channel: string) {
    if (!d.leadId) return;
    setLeads((all) => all.map((l) => l.id === d.leadId ? { ...l, stage: ["New", "Contacted", "Interested", "Meeting"].includes(l.stage) ? "Proposal Sent" : l.stage, value: total || l.value, history: [...(l.history || []), { at: new Date().toISOString(), channel, text: `Proposal sent (${inr(total)})` }] } : l));
  }

  async function sendEmail() {
    if (!emailTo) { setError("Enter the client's email."); return; }
    setBusy("Sending…"); setError("");
    try {
      await api("/api/email", { apiKey: settings.resendKey, from: settings.emailFrom, to: emailTo, subject: `Digital growth proposal for ${d.client} — ${settings.agencyName}`, html: html() });
      markSent("Email"); setNotice(`Proposal emailed to ${emailTo}.`);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  const waText = `Hi ${d.client}, here's a quick summary of our proposal from ${settings.agencyName}:\n\n${d.problems.split("\n").filter(Boolean).map((p) => "• " + p).join("\n")}\n\nRecommended: ${d.items.map((i) => i.service).join(", ")}\nInvestment: ${inr(total)}\n\nCan we schedule a 15-minute call?`;
  const phone = leads.find((l) => l.id === d.leadId)?.phone || "";

  return (
    <Shell icon="📄" title="Proposal Generator" desc="Turn lead & audit data into a branded proposal: problems found → recommended services → investment. Print/save as PDF, email it or share on WhatsApp.">
      <div className="tk-grid no-print" style={{ ["--min" as string]: "380px", alignItems: "start" }}>
        <div>
          <Card title="1. Client">
            <Field label="Load from CRM lead"><select className="tk-select" value={d.leadId} onChange={(e) => fromLead(e.target.value)}>
              <option value="">— choose a saved lead —</option>
              {leads.slice().sort((a, b) => b.leadScore - a.leadScore).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.leadScore})</option>)}
            </select></Field>
            <div className="tk-grid" style={{ marginTop: 10, ["--min" as string]: "160px" }}>
              <Field label="Client name"><input className="tk-input" value={d.client} onChange={(e) => set({ client: e.target.value })} /></Field>
              <Field label="Industry"><input className="tk-input" value={d.industry} onChange={(e) => set({ industry: e.target.value })} /></Field>
            </div>
            <div style={{ marginTop: 10 }}><Field label="Problems found (one per line)"><textarea className="tk-textarea" value={d.problems} onChange={(e) => set({ problems: e.target.value })} /></Field></div>
          </Card>
          <Card title="2. Services & pricing">
            {d.items.map((it, i) => (
              <div key={i} className="tk-row" style={{ flexWrap: "nowrap", marginBottom: 6 }}>
                <input className="tk-input" value={it.service} onChange={(e) => set({ items: d.items.map((x, j) => j === i ? { ...x, service: e.target.value } : x) })} />
                <input className="tk-input" type="number" style={{ width: 110 }} value={it.price} onChange={(e) => set({ items: d.items.map((x, j) => j === i ? { ...x, price: +e.target.value } : x) })} />
                <button className="tk-btn sm danger" onClick={() => set({ items: d.items.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <div className="tk-row">{CATALOG.filter((c) => !d.items.some((i) => i.service === c.service)).map((c) => <button key={c.service} className="tk-btn sm" onClick={() => set({ items: [...d.items, c] })}>+ {c.service}</button>)}</div>
            <div className="tk-grid" style={{ marginTop: 10, ["--min" as string]: "140px" }}>
              <Field label="Timeline"><input className="tk-input" value={d.timeline} onChange={(e) => set({ timeline: e.target.value })} /></Field>
              <Field label="Valid for"><input className="tk-input" value={d.validity} onChange={(e) => set({ validity: e.target.value })} /></Field>
            </div>
          </Card>
          <Card title="3. Write & send">
            <div className="tk-row">
              <button className="tk-btn" disabled={!!busy} onClick={aiWrite}>🤖 AI write strategy</button>
              <button className="tk-btn primary" onClick={() => { markSent("PDF"); window.print(); }}>🖨 Print / PDF</button>
              {phone && <a className="tk-btn green" target="_blank" rel="noreferrer" href={waLink(phone, waText)} onClick={() => markSent("WhatsApp")}>💬 WhatsApp</a>}
              <button className="tk-btn sm danger" onClick={() => setD(EMPTY)}>Reset</button>
            </div>
            <div className="tk-row" style={{ marginTop: 10, flexWrap: "nowrap" }}>
              <input className="tk-input" placeholder="client@email.com" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
              <button className="tk-btn" disabled={!!busy} onClick={sendEmail}>📧 Email</button>
            </div>
            {busy && <p className="tk-muted">⏳ {busy}</p>}
            <div style={{ marginTop: 10 }}><Field label="Strategy text (editable)"><textarea className="tk-textarea" style={{ minHeight: 140 }} value={d.intro} onChange={(e) => set({ intro: e.target.value })} /></Field></div>
          </Card>
          <ErrorBox error={error} />
          {notice && <Banner tone="ok">{notice}</Banner>}
        </div>
        <Preview d={d} total={total} agency={settings} />
      </div>
      <div className="print-only"><Preview d={d} total={total} agency={settings} /></div>
      <style>{`.print-only{display:none} @media print{.print-only{display:block}}`}</style>
    </Shell>
  );
}

function Preview({ d, total, agency }: { d: Draft; total: number; agency: { agencyName: string; agencyPhone: string; agencyEmail: string; agencyWebsite: string } }) {
  return (
    <div style={{ background: "#fff", color: "#111", borderRadius: 12, border: "1px solid var(--border)", padding: 32, fontSize: 14, lineHeight: 1.6 }}>
      <div style={{ borderBottom: "3px solid #4f46e5", paddingBottom: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#4f46e5", letterSpacing: 1 }}>{(agency.agencyName || "YOUR AGENCY").toUpperCase()}</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Digital Growth Proposal</div>
        <div style={{ color: "#666", fontSize: 12 }}>{new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</div>
      </div>
      <p><b>Client:</b> {d.client || "—"} {d.industry && <span style={{ color: "#666" }}>({d.industry})</span>}</p>
      <h3 style={{ fontSize: 16, color: "#4f46e5" }}>Problems found</h3>
      <ul>{d.problems.split("\n").filter(Boolean).map((p) => <li key={p}>{p}</li>)}</ul>
      {d.intro && <div style={{ whiteSpace: "pre-wrap", margin: "12px 0" }}>{d.intro}</div>}
      <h3 style={{ fontSize: 16, color: "#4f46e5" }}>Recommended services</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {d.items.map((i) => (
            <tr key={i.service}><td style={{ padding: "8px 0", borderBottom: "1px solid #eee" }}>✓ <b>{i.service}</b><div style={{ color: "#666", fontSize: 12 }}>{i.desc}</div></td><td style={{ textAlign: "right", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>{inr(i.price)}</td></tr>
          ))}
          <tr><td style={{ padding: "10px 0", fontWeight: 700 }}>Total investment</td><td style={{ textAlign: "right", fontWeight: 800, fontSize: 18 }}>{inr(total)}</td></tr>
        </tbody>
      </table>
      <p style={{ color: "#666", fontSize: 12 }}>Timeline: {d.timeline} · Valid for {d.validity} · Prices exclusive of GST.</p>
      <div style={{ marginTop: 20, paddingTop: 10, borderTop: "1px solid #eee", fontSize: 12, color: "#444" }}>{[agency.agencyName, agency.agencyPhone, agency.agencyEmail, agency.agencyWebsite].filter(Boolean).join(" · ")}</div>
    </div>
  );
}

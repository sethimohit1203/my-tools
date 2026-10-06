"use client";
import { useEffect, useRef, useState } from "react";
import { Banner, Card, ErrorBox, Field, Shell } from "../lib/ui";
import { AuditView, scoreColor, type Audit } from "../lib/audit-view";
import { aiText, api, useSettings } from "../lib/settings";
import { useQueryParam, useStored, uid } from "../lib/store";
import { escapeHtml } from "../lib/csv";

type Client = { id: string; name: string; url: string; email: string; keywords: string; history: { at: string; score: number }[] };

export default function ReportsPage() {
  const [settings] = useSettings();
  const qUrl = useQueryParam("url");
  const [clients, setClients] = useStored<Client[]>("report-clients", []);
  const [form, setForm] = useState({ name: "", url: "", email: "", keywords: "" });
  const [audit, setAudit] = useState<Audit | null>(null);
  const [analysis, setAnalysis] = useState("");
  const [current, setCurrent] = useState<Client | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pre = useRef(false);

  useEffect(() => {
    if (qUrl && !pre.current) { pre.current = true; void Promise.resolve().then(() => setForm((f) => ({ ...f, url: qUrl }))); }
  }, [qUrl]);

  async function generate(c: Client) {
    setCurrent(c); setAudit(null); setAnalysis(""); setError(""); setNotice("");
    try {
      setBusy(`Auditing ${c.url}…`);
      const { result } = await api<{ result: Audit }>("/api/audit", { url: c.url, deep: true });
      setAudit(result);
      const prev = c.history.at(-1);
      setClients((all) => all.map((x) => x.id === c.id ? { ...x, history: [...x.history, { at: new Date().toISOString(), score: result.score }].slice(-24) } : x));
      setBusy("AI is writing the analysis…");
      const failed = result.checks.filter((k) => !k.pass).map((k) => k.label).join("; ");
      setAnalysis(await aiText(`Write a monthly website & SEO report for client "${c.name}" (${result.finalUrl}) from ${settings.agencyName}.
Score now ${result.score}/100${prev ? ` (last report ${prev.score}/100 on ${prev.at.slice(0, 10)})` : ""}. Category scores: ${JSON.stringify(result.categoryScores)}. Speed ${(result.ms / 1000).toFixed(1)}s. ${result.wordCount} words on homepage. Failed checks: ${failed || "none"}. Target keywords: ${c.keywords || "n/a"}.
Sections: 1) Summary for the business owner (3-4 sentences, mention change vs last month) 2) What's working 3) Issues & their business impact 4) Actions we'll take next month 5) What we need from the client. Clear, positive, non-technical. Plain text with headings.`, { maxTokens: 2000 }).catch((e) => `AI analysis unavailable: ${(e as Error).message}`));
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  function addClient() {
    if (!form.name || !form.url) { setError("Client name and website are required."); return; }
    const c: Client = { id: uid(), ...form, history: [] };
    setClients([...clients, c]); setForm({ name: "", url: "", email: "", keywords: "" });
    void generate(c);
  }

  async function email() {
    if (!current || !audit) return;
    if (!current.email) { setError("Add the client's email."); return; }
    setBusy("Emailing…");
    try {
      const rows = audit.checks.map((k) => `<tr><td style="padding:4px 8px">${k.pass ? "✅" : "❌"}</td><td style="padding:4px 8px">${escapeHtml(k.label)}</td></tr>`).join("");
      const html = `<div style="font-family:Arial,sans-serif;max-width:680px"><h2 style="color:#4f46e5">${escapeHtml(settings.agencyName)} — Monthly Website Report</h2><p><b>${escapeHtml(current.name)}</b> · ${escapeHtml(audit.finalUrl)} · ${new Date().toLocaleDateString("en-IN")}</p><p style="font-size:28px;font-weight:bold;color:${scoreColor(audit.score)}">${audit.score}/100</p><div style="white-space:pre-wrap">${escapeHtml(analysis)}</div><h3>Checks</h3><table>${rows}</table><p style="color:#666">${escapeHtml([settings.agencyName, settings.agencyPhone, settings.agencyWebsite].filter(Boolean).join(" · "))}</p></div>`;
      await api("/api/email", { apiKey: settings.resendKey, from: settings.emailFrom, to: current.email, subject: `${current.name}: website report — ${new Date().toLocaleString("en-IN", { month: "long", year: "numeric" })}`, html });
      setNotice(`Report emailed to ${current.email}.`);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  return (
    <Shell icon="📊" title="Report Automation" desc="Website data → AI analysis → client-ready PDF → email. Save your clients once, then generate each month's report in one click; scores are tracked month over month. (For fully hands-free monthly emails, use the “Audit report” template in the Workflow Builder with a schedule.)"
      actions={audit ? <button className="tk-btn sm" onClick={() => window.print()}>🖨 PDF</button> : null}>
      <div className="no-print">
        <Card title="Clients">
          {clients.map((c) => (
            <div key={c.id} className="tk-check">
              <div style={{ flex: 1 }}><b>{c.name}</b> <span className="tk-muted">{c.url} · {c.email || "no email"}</span>
                <div className="tk-muted">History: {c.history.map((h) => `${h.at.slice(5, 10)}: ${h.score}`).join(" → ") || "—"}</div></div>
              <button className="tk-btn sm primary" disabled={!!busy} onClick={() => generate(c)}>Generate report</button>
              <button className="tk-btn sm danger" onClick={() => setClients(clients.filter((x) => x.id !== c.id))}>✕</button>
            </div>
          ))}
          <div className="tk-grid" style={{ ["--min" as string]: "180px", marginTop: 10 }}>
            <Field label="Client name"><input className="tk-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Website"><input className="tk-input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
            <Field label="Client email"><input className="tk-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Target keywords"><input className="tk-input" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} /></Field>
          </div>
          <button className="tk-btn" style={{ marginTop: 10 }} onClick={addClient}>+ Add client & generate</button>
        </Card>
        <ErrorBox error={error} />
        {notice && <Banner tone="ok">{notice}</Banner>}
        {busy && <Banner tone="info">⏳ {busy}</Banner>}
        {audit && <div className="tk-row" style={{ marginBottom: 12 }}><button className="tk-btn primary" onClick={() => window.print()}>🖨 Save as PDF</button><button className="tk-btn" disabled={!!busy} onClick={email}>📧 Email to {current?.email || "client"}</button></div>}
      </div>
      {audit && current && (
        <div>
          <div style={{ borderBottom: "3px solid #4f46e5", paddingBottom: 10, marginBottom: 16 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#4f46e5" }}>{settings.agencyName} — Monthly Website Report</div>
            <div className="tk-muted">{current.name} · {audit.finalUrl} · {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</div>
          </div>
          {analysis && <Card title="Analysis"><pre className="tk-pre">{analysis}</pre></Card>}
          <AuditView a={audit} />
        </div>
      )}
    </Shell>
  );
}

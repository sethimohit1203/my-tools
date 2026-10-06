"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Banner, Card, ErrorBox, Shell } from "../lib/ui";
import { AuditView, type Audit } from "../lib/audit-view";
import { aiText, api } from "../lib/settings";
import { useQueryParam, useStored } from "../lib/store";
import { download } from "../lib/csv";

export default function WebsiteAnalyzerPage() {
  const qUrl = useQueryParam("url");
  const [url, setUrl] = useState("");
  const [audit, setAudit] = useStored<Audit | null>("seo-audit-last", null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ai, setAi] = useState("");
  const started = useRef(false);

  async function run(target = url) {
    if (!target.trim()) return;
    setBusy("Fetching and analyzing the page (speed, SEO, mobile, links)…"); setError(""); setAi("");
    try {
      const { result } = await api<{ result: Audit }>("/api/audit", { url: target, deep: true });
      setAudit(result);
      if (result.error && !result.checks.length) setError(`Couldn't load the site: ${result.error}`);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  useEffect(() => {
    if (qUrl && !started.current) { started.current = true; void (async () => { setUrl(qUrl); await run(qUrl); })(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qUrl]);

  async function aiSummary() {
    if (!audit) return;
    setBusy("AI is writing recommendations…");
    try {
      const failed = audit.checks.filter((c) => !c.pass).map((c) => `${c.label}${c.detail ? ` (${c.detail})` : ""}`);
      setAi(await aiText(`Website audit for ${audit.finalUrl} (platform ${audit.platform}). Score ${audit.score}/100. Category scores: ${JSON.stringify(audit.categoryScores)}.
Title: "${audit.title}". Meta: "${audit.metaDescription}". Words: ${audit.wordCount}. Failed checks: ${failed.join("; ") || "none"}.
Write for a non-technical Indian business owner:
1. A 3-line executive summary.
2. Top 5 prioritised fixes (what, why it matters for customers/Google, effort: low/med/high).
3. A better SEO title (≤60 chars) and meta description (≤155 chars).
4. Which services an agency should offer (website redesign, SEO, social, Google Ads, WhatsApp automation) and why.
Use short headings and bullet points.`, { maxTokens: 1800 }));
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  return (
    <Shell icon="🩺" title="Website Analyzer" desc="Checks speed, HTTPS, mobile-friendliness, SEO tags, structured data, robots/sitemap, broken links, contact options (WhatsApp, forms, map) and social profiles. Scored /100 with fixes."
      actions={audit ? <><button className="tk-btn sm" onClick={() => window.print()}>🖨 PDF</button><button className="tk-btn sm" onClick={() => download(JSON.stringify(audit, null, 2), "audit.json", "application/json")}>⬇ JSON</button></> : null}>
      <Card>
        <div className="tk-row" style={{ flexWrap: "nowrap" }}>
          <input className="tk-input" placeholder="example.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
          <button className="tk-btn primary" disabled={!!busy} onClick={() => run()}>Analyze</button>
        </div>
        {busy && <p className="tk-muted">⏳ {busy}</p>}
      </Card>
      <ErrorBox error={error} />
      {audit && (
        <>
          <div className="tk-row no-print" style={{ marginBottom: 12 }}>
            <button className="tk-btn" disabled={!!busy} onClick={aiSummary}>🤖 AI recommendations</button>
            <Link className="tk-btn" href={`/reports?url=${encodeURIComponent(audit.finalUrl)}`}>📊 Make client report</Link>
            <Link className="tk-btn" href="/proposal">📄 Proposal</Link>
          </div>
          {ai && <Card title="🤖 AI recommendations"><pre className="tk-pre">{ai}</pre></Card>}
          <AuditView a={audit} />
        </>
      )}
      {!audit && !busy && <Banner tone="info">Tip: open this tool from Lead Finder/CRM (“Full website audit”) to analyze a lead&apos;s site in one click.</Banner>}
    </Shell>
  );
}

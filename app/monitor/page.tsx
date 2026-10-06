"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Banner, Card, ErrorBox, Field, Shell, Stat } from "../lib/ui";
import { useStored, uid } from "../lib/store";
import { api, useSettings } from "../lib/settings";

type Snapshot = { at: string; url: string; up: boolean; status: number; ms: number; error?: string; title: string; metaDescription: string; h1: string; canonical: string; noindex: boolean; wordCount: number; contentHash: string; excerpt: string; sitemapUrls?: string[] };
type Site = { id: string; url: string; label: string; sitemap: boolean; last?: Snapshot; events: { at: string; changes: string[] }[] };

function diff(prev: Snapshot | undefined, next: Snapshot): string[] {
  if (!prev) return ["First snapshot saved"];
  const ch: string[] = [];
  if (prev.up && !next.up) ch.push(`🔴 Site DOWN (${next.error || "HTTP " + next.status})`);
  if (!prev.up && next.up) ch.push("🟢 Site back UP");
  if (prev.title !== next.title) ch.push(`Title changed: "${prev.title}" → "${next.title}"`);
  if (prev.metaDescription !== next.metaDescription) ch.push("Meta description changed");
  if (prev.h1 !== next.h1) ch.push(`H1 changed: "${prev.h1}" → "${next.h1}"`);
  if (prev.canonical !== next.canonical) ch.push("Canonical URL changed");
  if (!prev.noindex && next.noindex) ch.push("⚠️ Page is now NOINDEX");
  if (next.up && prev.contentHash !== next.contentHash) ch.push(`Content changed (${prev.wordCount} → ${next.wordCount} words)`);
  if (prev.sitemapUrls && next.sitemapUrls) {
    const b = new Set(prev.sitemapUrls), a = new Set(next.sitemapUrls);
    const added = next.sitemapUrls.filter((u) => !b.has(u)), removed = prev.sitemapUrls.filter((u) => !a.has(u));
    if (added.length) ch.push(`🆕 ${added.length} new page(s) in sitemap: ${added.slice(0, 5).join(", ")}${added.length > 5 ? "…" : ""}`);
    if (removed.length) ch.push(`${removed.length} page(s) removed from sitemap`);
  }
  if (next.up && prev.ms && next.ms > Math.max(3000, prev.ms * 3)) ch.push(`🐢 Slow response: ${(next.ms / 1000).toFixed(1)}s`);
  return ch;
}

export default function MonitorPage() {
  const [settings] = useSettings();
  const [sites, setSites] = useStored<Site[]>("monitor-sites", []);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [sitemap, setSitemap] = useState(true);
  const [auto, setAuto] = useState(0);
  const [alertEmail, setAlertEmail] = useStored("monitor-alert-email", "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const sitesRef = useRef(sites);
  useEffect(() => { sitesRef.current = sites; }, [sites]);

  async function check(ids?: string[]) {
    const list = sitesRef.current.filter((s) => !ids || ids.includes(s.id));
    const alerts: string[] = [];
    for (const [n, s] of list.entries()) {
      setBusy(`Checking ${n + 1}/${list.length}: ${s.url}`);
      try {
        const { snapshot } = await api<{ snapshot: Snapshot }>("/api/monitor", { url: s.url, sitemap: s.sitemap });
        const changes = diff(s.last, snapshot);
        const real = changes.filter((c) => c !== "First snapshot saved");
        if (real.length) alerts.push(`${s.label || s.url}:\n- ${real.join("\n- ")}`);
        setSites((all) => all.map((x) => x.id === s.id ? { ...x, last: snapshot, events: changes.length ? [{ at: snapshot.at, changes }, ...x.events].slice(0, 50) : x.events } : x));
      } catch (e) { setError((e as Error).message); }
    }
    setBusy("");
    if (alerts.length) {
      try { if ("Notification" in window && Notification.permission === "granted") new Notification("Website changes detected", { body: alerts.join("\n").slice(0, 200) }); } catch { /* ignore */ }
      if (alertEmail && settings.resendKey) {
        await api("/api/email", { apiKey: settings.resendKey, from: settings.emailFrom, to: alertEmail, subject: `🔔 ${alerts.length} website change(s) detected`, text: alerts.join("\n\n") }).catch((e) => setError("Alert email failed: " + e.message));
      }
    }
  }

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => { void check(); }, auto * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  function addSite() {
    if (!url.trim()) return;
    const s: Site = { id: uid(), url: url.trim(), label: label.trim(), sitemap, events: [] };
    setSites((x) => [...x, s]);
    setUrl(""); setLabel("");
    setTimeout(() => check([s.id]), 50);
  }

  const down = sites.filter((s) => s.last && !s.last.up).length;
  const latest = Math.max(0, ...sites.map((s) => (s.last ? +new Date(s.last.at) : 0)));
  const changed24 = sites.filter((s) => s.events[0] && latest - +new Date(s.events[0].at) < 86400000 && s.events[0].changes[0] !== "First snapshot saved").length;

  return (
    <Shell icon="🔔" title="Website / SEO Monitor" desc={<>Watch your sites, clients&apos; sites and competitors. Detects downtime, slow responses, title/meta/H1/canonical changes, noindex, content edits and new or removed sitemap pages. Checks run from this page (manually or on a timer while it&apos;s open); for 24×7 daily server checks use a scheduled workflow in the <Link href="/automation">Workflow Builder</Link>.</>}>
      <div className="tk-grid" style={{ ["--min" as string]: "140px", marginBottom: 14 }}>
        <Stat value={sites.length} label="Monitored" />
        <Stat value={sites.length - down} label="Up" color="#16a34a" />
        <Stat value={down} label="Down" color="#dc2626" />
        <Stat value={changed24} label="Changed (24h)" color="#d97706" />
      </div>
      <Card title="Add a website">
        <div className="tk-grid" style={{ ["--min" as string]: "200px" }}>
          <Field label="URL"><input className="tk-input" value={url} placeholder="https://competitor.com" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSite()} /></Field>
          <Field label="Label"><input className="tk-input" value={label} placeholder="Competitor — XYZ Cars" onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label="Options"><label className="tk-row" style={{ fontSize: 13, paddingTop: 7 }}><input type="checkbox" checked={sitemap} onChange={(e) => setSitemap(e.target.checked)} /> Track sitemap (new pages)</label></Field>
        </div>
        <button className="tk-btn primary" style={{ marginTop: 10 }} onClick={addSite}>+ Add & take first snapshot</button>
      </Card>
      <Card title="Checks & alerts">
        <div className="tk-row">
          <button className="tk-btn primary" disabled={!!busy || !sites.length} onClick={() => check()}>🔄 Check all now</button>
          <select className="tk-select" style={{ maxWidth: 230 }} value={auto} onChange={(e) => { setAuto(+e.target.value); if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); }}>
            <option value={0}>Auto-check: off</option><option value={5}>Every 5 min (while open)</option><option value={15}>Every 15 min</option><option value={60}>Every hour</option>
          </select>
          <input className="tk-input" style={{ maxWidth: 260 }} placeholder="Email alerts to (needs Resend in Settings)" value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)} />
          {busy && <span className="tk-muted">⏳ {busy}</span>}
        </div>
      </Card>
      <ErrorBox error={error} />
      {!sites.length && <Banner tone="info">Add your first site above.</Banner>}
      {sites.map((s) => (
        <Card key={s.id} title={<>{s.last ? (s.last.up ? "🟢" : "🔴") : "⚪"} {s.label || s.url}</>} actions={<>
          <a className="tk-btn sm" href={s.url} target="_blank" rel="noreferrer">↗</a>
          <button className="tk-btn sm" disabled={!!busy} onClick={() => check([s.id])}>Check</button>
          <button className="tk-btn sm danger" onClick={() => setSites((x) => x.filter((y) => y.id !== s.id))}>Remove</button>
        </>}>
          {s.last && <div className="tk-muted" style={{ marginBottom: 8 }}>HTTP {s.last.status || "—"} · {(s.last.ms / 1000).toFixed(2)}s · “{s.last.title}” · {s.last.wordCount} words{s.last.sitemapUrls ? ` · ${s.last.sitemapUrls.length} sitemap URLs` : ""} · last checked {new Date(s.last.at).toLocaleString("en-IN")}</div>}
          {s.events.slice(0, 6).map((e, i) => (
            <div key={i} className="tk-check"><span className="tk-muted" style={{ whiteSpace: "nowrap" }}>{new Date(e.at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</span><div>{e.changes.map((c) => <div key={c}>{c}</div>)}</div></div>
          ))}
          {s.last && s.events.length === 1 && <div className="tk-muted">No changes since the first snapshot.</div>}
        </Card>
      ))}
    </Shell>
  );
}

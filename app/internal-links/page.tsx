"use client";
import { useState } from "react";
import { Banner, Card, ErrorBox, Field, Shell, Stat, Tabs } from "../lib/ui";
import { api } from "../lib/settings";
import { useStored } from "../lib/store";
import { downloadCSV } from "../lib/csv";

type Res = {
  pages: { url: string; title: string; inbound: number; outbound: number }[];
  targets: { url: string; title: string; phrase: string }[];
  suggestions: { from: string; fromTitle: string; to: string; anchor: string; context: string }[];
  orphans: { url: string; title: string }[];
};

const short = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";

export default function InternalLinksPage() {
  const [site, setSite] = useState("");
  const [urls, setUrls] = useState("");
  const [max, setMax] = useState(40);
  const [res, setRes] = useStored<Res | null>("ilinks-last", null);
  const [tab, setTab] = useState<"sugg" | "pages" | "orphans">("sugg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!site.trim() && !urls.trim()) { setError("Enter your site URL (we read its sitemap) or paste page URLs."); return; }
    setBusy(true); setError("");
    try {
      const list = urls.split("\n").map((u) => u.trim()).filter(Boolean);
      setRes(await api<Res>("/api/internal-links", { site, urls: list, maxPages: max }));
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  return (
    <Shell icon="🔗" title="Internal Link Builder" desc="Crawls your sitemap, takes each page's main topic (from its title), and finds other pages that mention that topic but don't link to it yet — ready-made internal links with anchor text. Also flags orphan pages with no internal links pointing to them.">
      <Card>
        <div className="tk-grid" style={{ ["--min" as string]: "220px" }}>
          <Field label="Website (uses sitemap.xml)"><input className="tk-input" value={site} placeholder="https://prorido.com" onChange={(e) => setSite(e.target.value)} /></Field>
          <Field label="Pages to scan"><select className="tk-select" value={max} onChange={(e) => setMax(+e.target.value)}>{[20, 40, 60].map((n) => <option key={n} value={n}>{n} pages</option>)}</select></Field>
        </div>
        <div style={{ marginTop: 10 }}><Field label="…or paste page URLs (one per line)"><textarea className="tk-textarea" value={urls} onChange={(e) => setUrls(e.target.value)} /></Field></div>
        <button className="tk-btn primary" style={{ marginTop: 10 }} disabled={busy} onClick={run}>{busy ? "⏳ Crawling pages (up to a minute)…" : "Find link opportunities"}</button>
      </Card>
      <ErrorBox error={error} />
      {res && (
        <>
          <div className="tk-grid" style={{ ["--min" as string]: "150px", marginBottom: 12 }}>
            <Stat value={res.pages.length} label="Pages crawled" />
            <Stat value={res.suggestions.length} label="Link opportunities" color="#16a34a" />
            <Stat value={res.orphans.length} label="Orphan pages" color="#dc2626" />
          </div>
          <Tabs value={tab} onChange={setTab} items={[{ id: "sugg", label: "💡 Suggestions" }, { id: "pages", label: "📄 Pages" }, { id: "orphans", label: "🏝 Orphans" }]} />
          {tab === "sugg" && (
            <Card actions={<button className="tk-btn sm" onClick={() => downloadCSV(res.suggestions, "internal-links.csv", ["from", "anchor", "to", "context"])}>⬇ CSV</button>}>
              {!res.suggestions.length && <Banner tone="info">No missing links found — pages already link to each other, or titles are too generic.</Banner>}
              <div className="tk-table-wrap"><table className="tk-table">
                <thead><tr><th>On page</th><th>Link this text</th><th>To page</th><th>Context</th></tr></thead>
                <tbody>{res.suggestions.map((s, i) => (
                  <tr key={i}><td><a href={s.from} target="_blank" rel="noreferrer">{short(s.from)}</a></td><td><b>“{s.anchor}”</b></td><td><a href={s.to} target="_blank" rel="noreferrer">{short(s.to)}</a></td><td className="tk-muted" style={{ maxWidth: 380 }}>{s.context}</td></tr>
                ))}</tbody>
              </table></div>
            </Card>
          )}
          {tab === "pages" && (
            <div className="tk-table-wrap"><table className="tk-table">
              <thead><tr><th>Page</th><th>Title</th><th>Topic phrase</th><th>Inbound</th><th>Outbound</th></tr></thead>
              <tbody>{res.pages.sort((a, b) => a.inbound - b.inbound).map((p) => (
                <tr key={p.url}><td><a href={p.url} target="_blank" rel="noreferrer">{short(p.url)}</a></td><td>{p.title}</td><td className="tk-muted">{res.targets.find((t) => t.url === p.url)?.phrase || "—"}</td><td><span className={`tk-badge ${p.inbound === 0 ? "red" : p.inbound < 3 ? "amber" : "green"}`}>{p.inbound}</span></td><td>{p.outbound}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {tab === "orphans" && (
            <Card>{res.orphans.length ? res.orphans.map((o) => <div key={o.url} className="tk-check">🏝 <a href={o.url} target="_blank" rel="noreferrer">{o.title || o.url}</a></div>) : <span className="tk-muted">No orphan pages among the crawled set. 🎉</span>}</Card>
          )}
        </>
      )}
    </Shell>
  );
}

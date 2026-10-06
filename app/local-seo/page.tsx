"use client";
import { useMemo, useState } from "react";
import { Banner, Card, ErrorBox, Field, ScoreBadge, Shell, Stat } from "../lib/ui";
import { searchBusinesses } from "../lib/search";
import { aiText, api, useSettings } from "../lib/settings";
import { useStored } from "../lib/store";
import type { BizResult } from "../lib/osm";
import { downloadCSV } from "../lib/csv";

type Row = BizResult & { strength: number; siteScore?: number; siteError?: string };

export default function LocalSEOPage() {
  const [settings] = useSettings();
  const [source, setSource] = useState<"google" | "osm">(settings.googlePlacesKey ? "google" : "osm");
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [client, setClient] = useState("");
  const [rows, setRows] = useStored<Row[]>("localseo-rows", []);
  const [meta, setMeta] = useStored<{ keyword: string; location: string }>("localseo-meta", { keyword: "", location: "" });
  const [plan, setPlan] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function run() {
    if (!keyword.trim() || !location.trim()) { setError("Enter both a keyword and a location."); return; }
    setError(""); setPlan("");
    try {
      const { results } = await searchBusinesses({ source, query: keyword, location, radiusM: 10000, limit: source === "google" ? 60 : 100, googleKey: settings.googlePlacesKey, onProgress: setBusy });
      const scored = results.map((r) => ({ ...r, strength: Math.round((r.ratingValue || 0) * 10 + Math.log10((r.reviews || 0) + 1) * 15 + (r.website ? 10 : 0) + (r.phone ? 5 : 0)) }));
      setRows(scored.sort((a, b) => b.strength - a.strength));
      setMeta({ keyword, location });
      if (!results.length) setError("No businesses found — try a broader keyword or location.");
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  async function auditTop() {
    const top = rows.filter((r) => r.website).slice(0, 15);
    if (!top.length) return;
    setBusy(`Auditing ${top.length} competitor websites…`);
    try {
      const { results } = await api<{ results: { score: number; error?: string }[] }>("/api/audit", { urls: top.map((r) => r.website) });
      const m = new Map(top.map((r, i) => [r.id, results[i]]));
      setRows(rows.map((r) => (m.has(r.id) ? { ...r, siteScore: m.get(r.id)!.score, siteError: m.get(r.id)!.error } : r)));
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  const s = useMemo(() => {
    const rated = rows.filter((r) => r.ratingValue);
    const audited = rows.filter((r) => r.siteScore != null && !r.siteError);
    return {
      total: rows.length,
      avgRating: rated.length ? (rated.reduce((a, r) => a + (r.ratingValue || 0), 0) / rated.length).toFixed(2) : "—",
      avgReviews: rated.length ? Math.round(rated.reduce((a, r) => a + (r.reviews || 0), 0) / rated.length) : "—",
      withSite: rows.filter((r) => r.website).length,
      noSite: rows.filter((r) => !r.website).length,
      weakSite: audited.filter((r) => (r.siteScore || 0) < 50).length,
      lowRating: rated.filter((r) => (r.ratingValue || 0) < 4).length,
      lowReviews: rated.filter((r) => (r.reviews || 0) < 50).length,
    };
  }, [rows]);

  const opportunity = s.total ? Math.round(((s.noSite + s.weakSite) / s.total) * 100) : 0;

  async function aiPlan() {
    setBusy("AI is writing the competitive strategy…");
    try {
      const top = rows.slice(0, 15).map((r) => `${r.name} — ${r.ratingValue ?? "?"}★ (${r.reviews ?? "?"} reviews), website: ${r.website ? (r.siteScore != null ? r.siteScore + "/100" : "yes") : "none"}`);
      setPlan(await aiText(`Local SEO market analysis for "${meta.keyword}" in ${meta.location}.
Market: ${s.total} businesses, avg rating ${s.avgRating}, avg reviews ${s.avgReviews}, ${s.noSite} without website, ${s.weakSite} weak websites, ${s.lowRating} rated under 4★.
Top competitors:\n${top.join("\n")}
${client ? `Our client: ${client}.` : ""}
Write a practical plan to ${client ? `help ${client} rank in the Google Maps 3-pack and beat these competitors` : "win in this local market"}:
1) Market summary 2) What the top 3 do well 3) Gaps/weaknesses to exploit 4) Google Business Profile actions (categories, posts, photos, Q&A, review targets with numbers) 5) Website & on-page SEO actions (pages, keywords, schema) 6) Citations/backlinks 7) 90-day action plan. Be specific with numbers.`, { maxTokens: 3000 }));
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  return (
    <Shell icon="📍" title="Local SEO & Competitor Analyzer" desc="Who ranks for a local keyword, how strong they are (rating, reviews, website), where the gaps are — and an AI plan to beat them in the Google Maps pack."
      actions={rows.length ? <button className="tk-btn sm" onClick={() => window.print()}>🖨 PDF</button> : null}>
      <Card>
        <div className="tk-row" style={{ marginBottom: 10 }}>
          <button className={`tk-tab${source === "google" ? " on" : ""}`} onClick={() => setSource("google")}>📍 Google Places (ratings & reviews)</button>
          <button className={`tk-tab${source === "osm" ? " on" : ""}`} onClick={() => setSource("osm")}>🆓 OpenStreetMap (free)</button>
        </div>
        {source === "google" && !settings.googlePlacesKey && <Banner tone="warn">Add a Google Places key in ⚙ Settings (or GOOGLE_PLACES_API_KEY env) for ratings & reviews. OpenStreetMap works free but has no ratings.</Banner>}
        <div className="tk-grid" style={{ ["--min" as string]: "200px" }}>
          <Field label="Keyword / business type"><input className="tk-input" value={keyword} placeholder="car rental" onChange={(e) => setKeyword(e.target.value)} /></Field>
          <Field label="Location"><input className="tk-input" value={location} placeholder="Delhi" onChange={(e) => setLocation(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} /></Field>
          <Field label="Your client (optional)"><input className="tk-input" value={client} placeholder="ProRido" onChange={(e) => setClient(e.target.value)} /></Field>
        </div>
        <div className="tk-row" style={{ marginTop: 12 }}>
          <button className="tk-btn primary" disabled={!!busy} onClick={run}>Analyze market</button>
          {rows.length > 0 && <><button className="tk-btn" disabled={!!busy} onClick={auditTop}>🩺 Audit top competitor sites</button>
            <button className="tk-btn" disabled={!!busy} onClick={aiPlan}>🤖 AI: how to beat them</button>
            <button className="tk-btn" onClick={() => downloadCSV(rows as unknown as Record<string, unknown>[], "competitors.csv", ["name", "ratingValue", "reviews", "website", "siteScore", "phone", "address", "category", "strength", "mapsLink"])}>⬇ CSV</button></>}
          {busy && <span className="tk-muted">⏳ {busy}</span>}
        </div>
      </Card>
      <ErrorBox error={error} />
      {rows.length > 0 && (
        <>
          <h3 style={{ fontSize: 15 }}>Market overview — “{meta.keyword}” in {meta.location}</h3>
          <div className="tk-grid" style={{ ["--min" as string]: "140px", marginBottom: 14 }}>
            <Stat value={s.total} label="Businesses found" />
            <Stat value={s.avgRating} label="Average rating" />
            <Stat value={s.avgReviews} label="Average reviews" />
            <Stat value={s.withSite} label="With website" />
            <Stat value={s.noSite} label="No website" color="#dc2626" />
            <Stat value={s.weakSite} label="Weak website (<50)" color="#d97706" />
            <Stat value={s.lowRating} label="Rated under 4★" />
            <Stat value={s.lowReviews} label="Under 50 reviews" />
          </div>
          <Banner tone={opportunity >= 40 ? "ok" : opportunity >= 20 ? "warn" : "info"}>
            <b>SEO opportunity: {opportunity >= 40 ? "HIGH" : opportunity >= 20 ? "MEDIUM" : "LOW"}</b> — {s.noSite} businesses without a website, {s.weakSite} with weak websites, {s.lowRating} with low ratings. Average to beat: {s.avgRating}★ and {s.avgReviews} reviews.
          </Banner>
          {plan && <Card title="🤖 Competitive strategy"><pre className="tk-pre">{plan}</pre></Card>}
          <Card title="Top competitors (by strength: rating × reviews × website)">
            <div className="tk-table-wrap"><table className="tk-table">
              <thead><tr><th>#</th><th>Business</th><th>Rating</th><th>Reviews</th><th>Website</th><th>Strength</th></tr></thead>
              <tbody>{rows.slice(0, 60).map((r, i) => (
                <tr key={r.id}><td>{i + 1}</td><td><b>{r.name}</b><div className="tk-muted">{r.address}</div></td><td>{r.ratingValue ? `${r.ratingValue} ★` : "—"}</td><td>{r.reviews ?? "—"}</td>
                  <td>{r.website ? <><a href={r.website} target="_blank" rel="noreferrer">{r.website.replace(/^https?:\/\/(www\.)?/, "").slice(0, 26)}</a> {r.siteScore != null && <ScoreBadge score={r.siteScore} />}</> : <span className="tk-badge red">none</span>}</td>
                  <td><ScoreBadge score={r.strength} /></td></tr>
              ))}</tbody>
            </table></div>
          </Card>
        </>
      )}
    </Shell>
  );
}

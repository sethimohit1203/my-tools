"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Banner, Card, ErrorBox, Field, ScoreBadge, Shell, Stat, Tabs } from "../lib/ui";
import { useStored } from "../lib/store";
import { searchBusinesses } from "../lib/search";
import { PROFILES, toLead, waLink, leadColumns, leadRow, type Lead, type ProfileId } from "../lib/leads";
import { aiAnalyzeLeads, auditLeads, saveToCRM, syncToSheets } from "../lib/lead-actions";
import { downloadCSV } from "../lib/csv";
import { useSettings } from "../lib/settings";

const RADII = [1000, 2000, 3000, 5000, 10000, 20000];
const LIMITS = [10, 20, 25, 40, 50, 60, 100];

type WebsiteFilter = "any" | "with" | "without";

export default function LeadFinderPage() {
  const [settings] = useSettings();
  const [source, setSource] = useStored<"osm" | "google">("gmaps-source2", "osm");
  const [profile, setProfile] = useStored<ProfileId>("gmaps-profile", "designoia");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [radiusM, setRadiusM] = useState(3000);
  const [limit, setLimit] = useState(40);
  const [minRating, setMinRating] = useState(0);
  const [siteFilter, setSiteFilter] = useState<WebsiteFilter>("any");
  const [phoneOnly, setPhoneOnly] = useState(false);
  const [tempFilter, setTempFilter] = useState("");
  const [results, setResults] = useStored<Lead[]>("gmaps-results", []);
  const [history, setHistory] = useStored<string[]>("gmaps-history2", []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const P = PROFILES[profile];

  async function run() {
    if (!query.trim()) { setError("Type what to search for, e.g. \"cafes\" or \"coffee shop near Geeta Colony, Delhi\"."); return; }
    setError(""); setNotice(""); setSelected(new Set());
    setBusy("Searching…");
    try {
      const { results: found, centerLabel } = await searchBusinesses({
        source, query, location, radiusM, limit, googleKey: settings.googlePlacesKey, onProgress: setBusy,
      });
      const q = [query, location].filter(Boolean).join(" · ");
      setResults(found.map((r) => toLead(r, profile, q)));
      setHistory((h) => [q, ...h.filter((x) => x !== q)].slice(0, 10));
      if (!found.length) setError(`No businesses found${centerLabel ? ` near ${centerLabel.split(",").slice(0, 3).join(",")}` : ""}. Try a bigger radius, a simpler business word (e.g. "cafe"), or switch to Google Places.`);
      else setNotice(`Found ${found.length} businesses${centerLabel ? ` around ${centerLabel.split(",").slice(0, 3).join(",")}` : ""}. Next: 🩺 Audit websites → 🤖 AI analyze → 💾 Save to CRM.`);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy("");
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setError("Geolocation isn't available in this browser."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(`${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`),
      () => setError("Couldn't get your location — allow location access in the browser."),
    );
  }

  const filtered = useMemo(() => results.filter((r) => {
    if (minRating && (r.ratingValue ?? 0) < minRating) return false;
    if (siteFilter === "with" && !r.website) return false;
    if (siteFilter === "without" && r.website) return false;
    if (phoneOnly && !r.phone) return false;
    if (tempFilter && r.temperature !== tempFilter) return false;
    return true;
  }).sort((a, b) => b.leadScore - a.leadScore), [results, minRating, siteFilter, phoneOnly, tempFilter]);

  const targets = () => (selected.size ? filtered.filter((r) => selected.has(r.id)) : filtered);
  const replace = (updated: Lead[]) => { const m = new Map(updated.map((u) => [u.id, u])); setResults(results.map((r) => m.get(r.id) || r)); };

  async function doAudit() {
    const t = targets().filter((r) => r.website);
    if (!t.length) { setNotice("None of these businesses has a website — they're all website leads! 💻"); return; }
    setError("");
    try { replace(await auditLeads(t, (d, n) => setBusy(`Auditing websites ${d}/${n}…`))); setNotice(`Audited ${t.length} websites — scores updated.`); }
    catch (e) { setError((e as Error).message); }
    setBusy("");
  }
  async function doAI() {
    const t = targets().slice(0, 60);
    setError("");
    try { replace(await aiAnalyzeLeads(t, (d, n) => setBusy(`AI analyzing ${d}/${n}…`))); setNotice(`AI analyzed ${t.length} leads.`); }
    catch (e) { setError((e as Error).message + " — set an AI key in ⚙ Settings."); }
    setBusy("");
  }
  function doSave() {
    const t = targets();
    const added = saveToCRM(t);
    setNotice(`Saved ${t.length} leads to CRM (${added} new).`);
    setSelected(new Set());
  }
  async function doSheets() {
    setBusy("Syncing to Google Sheets…"); setError("");
    try { await syncToSheets(targets()); setNotice(`Sent ${targets().length} rows to Google Sheets (tab "Leads").`); }
    catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  // Opportunity generator
  const opp = useMemo(() => {
    const has = (r: Lead, re: RegExp) => r.opportunities.some((o) => re.test(o));
    return {
      total: results.length,
      withSite: results.filter((r) => r.website).length,
      noSite: results.filter((r) => !r.website).length,
      weak: results.filter((r) => r.audit && !r.audit.error && r.audit.score < 50).length,
      hot: results.filter((r) => r.temperature === "HOT").length,
      seo: results.filter((r) => has(r, /SEO/)).length,
      social: results.filter((r) => has(r, /Social/)).length,
      ads: results.filter((r) => has(r, /Ads|Lead capture/)).length,
      wa: results.filter((r) => has(r, /WhatsApp/)).length,
      innbly: results.filter((r) => has(r, /InnBly/)).length,
      col: results.filter((r) => r.profile === "col" && r.leadScore >= 60).length,
      avgRating: (() => { const r = results.filter((x) => x.ratingValue); return r.length ? (r.reduce((s, x) => s + (x.ratingValue || 0), 0) / r.length).toFixed(1) : "—"; })(),
    };
  }, [results]);

  const fname = (query || "leads").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return (
    <Shell icon="🗺️" title="Lead Finder & Scorer" wide
      desc={<>Business Growth OS · <b>Discover → Analyze → Score → Sell</b>. Search businesses, audit their websites, score them and push the best ones to your <Link href="/crm">CRM</Link>.</>}>

      <Tabs value={profile} onChange={(p) => { setProfile(p); setResults(results.map((r) => toLead(r, p, r.query, r))); }}
        items={(Object.keys(PROFILES) as ProfileId[]).map((id) => ({ id, label: `${PROFILES[id].icon} ${PROFILES[id].label}` }))} />

      <div className="tk-row" style={{ marginBottom: 12 }}>
        <button className={`tk-tab${source === "osm" ? " on" : ""}`} onClick={() => setSource("osm")}>🆓 OpenStreetMap — free, no key</button>
        <button className={`tk-tab${source === "google" ? " on" : ""}`} onClick={() => setSource("google")}>📍 Google Places — ratings & reviews {settings.googlePlacesKey ? "✓" : "(needs key)"}</button>
      </div>
      {source === "osm"
        ? <Banner tone="ok">Free search: finds the place with Nominatim/Photon (typo-tolerant) and lists every matching business in the radius from the OpenStreetMap Overpass API. Phone/website appear where the community added them; ratings &amp; reviews need Google Places. Data © OpenStreetMap contributors.</Banner>
        : <Banner tone="info">Official Google Places API (Text Search) with your key from <Link href="/settings">⚙ Settings</Link> — includes ratings, review counts and websites. Google bills per request after the monthly free credit.</Banner>}

      <Card>
        <div className="tk-grid" style={{ ["--min" as string]: "260px" }}>
          <Field label="What are you looking for? *" hint={P.desc}>
            <input className="tk-input" value={query} placeholder='e.g. "cafes" or "coffee shop near Geeta Colony, Delhi"' onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
          </Field>
          <Field label="Location" hint="City / area / landmark, or lat,lng. Optional if your query says “near …”.">
            <div className="tk-row" style={{ flexWrap: "nowrap" }}>
              <input className="tk-input" value={location} placeholder="Geeta Colony, Delhi" onChange={(e) => setLocation(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
              <button className="tk-btn" title="Use my location" onClick={useMyLocation}>🎯</button>
            </div>
          </Field>
        </div>
        <div className="tk-row" style={{ marginTop: 10 }}>
          {P.presets.map((p) => <button key={p} className="tk-btn sm" onClick={() => setQuery(p)}>{p}</button>)}
        </div>
        <div className="tk-grid" style={{ ["--min" as string]: "150px", marginTop: 12 }}>
          <Field label="Radius"><select className="tk-select" value={radiusM} onChange={(e) => setRadiusM(+e.target.value)}>{RADII.map((r) => <option key={r} value={r}>{r / 1000} km</option>)}</select></Field>
          <Field label="Max results"><select className="tk-select" value={limit} onChange={(e) => setLimit(+e.target.value)}>{LIMITS.filter((l) => source === "osm" || l <= 60).map((l) => <option key={l} value={l}>{l}</option>)}</select></Field>
          <Field label="Website"><select className="tk-select" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value as WebsiteFilter)}><option value="any">Any</option><option value="without">❌ Without website</option><option value="with">✅ With website</option></select></Field>
          <Field label="Min rating"><select className="tk-select" value={minRating} onChange={(e) => setMinRating(+e.target.value)}>{[0, 3, 3.5, 4, 4.5].map((r) => <option key={r} value={r}>{r ? `${r}+ ★` : "Any"}</option>)}</select></Field>
          <Field label="Lead temperature"><select className="tk-select" value={tempFilter} onChange={(e) => setTempFilter(e.target.value)}><option value="">All</option><option>HOT</option><option>WARM</option><option>COLD</option></select></Field>
          <Field label="Contact"><label className="tk-row" style={{ fontSize: 13, paddingTop: 7 }}><input type="checkbox" checked={phoneOnly} onChange={(e) => setPhoneOnly(e.target.checked)} /> Has phone only</label></Field>
        </div>
        <button className="tk-btn green" style={{ width: "100%", justifyContent: "center", marginTop: 14, padding: 12, fontSize: 15 }} disabled={!!busy} onClick={run}>
          {busy ? `⏳ ${busy}` : "🔍 Find & Score Businesses"}
        </button>
        {history.length > 0 && (
          <div className="tk-row" style={{ marginTop: 10 }}>
            <span className="tk-muted">Recent:</span>
            {history.slice(0, 6).map((h) => <button key={h} className="tk-btn sm" onClick={() => { const [q, l] = h.split(" · "); setQuery(q); setLocation(l || ""); }}>{h}</button>)}
          </div>
        )}
      </Card>

      <ErrorBox error={error} />
      {notice && !error && <Banner tone="ok">{notice}</Banner>}

      {results.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, margin: "18px 0 10px" }}>🎯 Business Opportunities</h3>
          <div className="tk-grid" style={{ ["--min" as string]: "140px", marginBottom: 14 }}>
            <Stat value={opp.total} label="Businesses found" />
            <Stat value={opp.hot} label="🔥 Hot leads" color="#dc2626" />
            <Stat value={opp.noSite} label="💻 No website" color="#6366f1" />
            <Stat value={opp.weak} label="🛠 Weak website" color="#d97706" />
            <Stat value={opp.seo} label="📈 SEO opportunity" />
            <Stat value={opp.social} label="📱 Social media" />
            <Stat value={opp.ads} label="📢 Ads / lead capture" />
            <Stat value={opp.wa} label="💬 WhatsApp automation" color="#16a34a" />
            {profile === "innbly" && <Stat value={opp.innbly} label="🏨 InnBly opportunity" />}
            {profile === "col" && <Stat value={opp.col} label="🎓 COL partnership" />}
            <Stat value={opp.avgRating} label="Avg rating" />
          </div>

          <Card title={`${filtered.length} results ${selected.size ? `· ${selected.size} selected` : ""}`} actions={<>
            <button className="tk-btn sm" disabled={!!busy} onClick={doAudit}>🩺 Audit websites</button>
            <button className="tk-btn sm" disabled={!!busy} onClick={doAI}>🤖 AI analyze</button>
            <button className="tk-btn sm primary" disabled={!!busy} onClick={doSave}>💾 Save to CRM</button>
            <button className="tk-btn sm" onClick={() => downloadCSV(targets().map(leadRow), `${fname}.csv`, leadColumns())}>⬇ CSV</button>
            <button className="tk-btn sm" disabled={!!busy} onClick={doSheets}>📋 Sheets</button>
            <button className="tk-btn sm danger" onClick={() => { setResults([]); setSelected(new Set()); }}>Clear</button>
          </>}>
            <p className="tk-muted" style={{ marginTop: -4 }}>Actions apply to the selected rows, or to all filtered rows when nothing is selected.</p>
            <div className="tk-table-wrap">
              <table className="tk-table">
                <thead><tr>
                  <th><input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length} onChange={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id)))} /></th>
                  <th>Business</th><th>Phone</th><th>Website</th><th>Rating</th><th>{P.scoreLabel}</th><th>Opportunities</th><th></th>
                </tr></thead>
                <tbody>
                  {filtered.map((r) => (
                    <FragmentRow key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)}
                      checked={selected.has(r.id)} onCheck={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {!results.length && !busy && !error && (
        <Card><div style={{ textAlign: "center", padding: "30px 10px", color: "var(--sub)" }}>
          <div style={{ fontSize: 40 }}>📍</div>
          <p>Try <b>“coffee shop near Geeta Colony, Delhi”</b>, <b>“schools in Laxmi Nagar”</b> or pick a preset above.</p>
        </div></Card>
      )}
    </Shell>
  );
}

function FragmentRow({ r, open, onToggle, checked, onCheck }: { r: Lead; open: boolean; onToggle: () => void; checked: boolean; onCheck: () => void }) {
  const tempTone = r.temperature === "HOT" ? "red" : r.temperature === "WARM" ? "amber" : "";
  return (
    <>
      <tr>
        <td><input type="checkbox" checked={checked} onChange={onCheck} /></td>
        <td style={{ minWidth: 200 }}>
          <div style={{ fontWeight: 600 }}>{r.name}</div>
          <div className="tk-muted">{[r.category, r.distanceKm != null ? `${r.distanceKm} km` : ""].filter(Boolean).join(" · ")}</div>
          <div className="tk-muted" style={{ fontSize: 11 }}>{r.address}</div>
        </td>
        <td style={{ whiteSpace: "nowrap" }}>{r.phone ? <><a href={`tel:${r.phone}`}>{r.phone}</a><br /><a href={waLink(r.phone, r.ai?.pitch || `Hi ${r.name}, `)} target="_blank" rel="noreferrer">💬 WhatsApp</a></> : <span className="tk-muted">—</span>}</td>
        <td style={{ maxWidth: 200 }}>
          {r.website ? <><a href={r.website.startsWith("http") ? r.website : `https://${r.website}`} target="_blank" rel="noreferrer">{r.website.replace(/^https?:\/\/(www\.)?/, "").slice(0, 30)}</a>
            <div>{r.audit ? (r.audit.error ? <span className="tk-badge red">unreachable</span> : <>Score <ScoreBadge score={r.audit.score} /></>) : <span className="tk-muted">not audited</span>}</div></>
            : <span className="tk-badge red">No website</span>}
        </td>
        <td style={{ whiteSpace: "nowrap" }}>{r.rating || <span className="tk-muted">—</span>}</td>
        <td><ScoreBadge score={r.leadScore} /> <span className={`tk-badge ${tempTone}`}>{r.temperature}</span></td>
        <td style={{ maxWidth: 240, fontSize: 12 }}>{r.opportunities.slice(0, 3).join(", ")}{r.opportunities.length > 3 ? "…" : ""}</td>
        <td style={{ whiteSpace: "nowrap" }}>
          <button className="tk-btn sm" onClick={onToggle}>{open ? "▲" : "▼"}</button>{" "}
          {r.mapsLink && <a className="tk-btn sm" href={r.mapsLink} target="_blank" rel="noreferrer">🗺</a>}
        </td>
      </tr>
      {open && (
        <tr><td></td><td colSpan={7} style={{ background: "var(--hover)" }}>
          <div className="tk-grid" style={{ ["--min" as string]: "260px" }}>
            <div><b>Why this score</b><ul style={{ margin: "6px 0", paddingLeft: 18 }}>{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul></div>
            <div><b>Opportunities</b><ul style={{ margin: "6px 0", paddingLeft: 18 }}>{r.opportunities.map((x) => <li key={x}>{x}</li>)}</ul>
              {r.audit && !r.audit.error && <div className="tk-muted">Platform: {r.audit.platform} · Mobile {r.audit.mobile ? "✅" : "❌"} · HTTPS {r.audit.https ? "✅" : "❌"} · WhatsApp {r.audit.hasWhatsApp ? "✅" : "❌"} · Form {r.audit.hasContactForm ? "✅" : "❌"} · Social: {Object.keys(r.audit.social).join(", ") || "none"}</div>}
            </div>
            {r.ai && <div><b>🤖 AI analysis</b><p style={{ margin: "6px 0" }}>{r.ai.summary}</p>{r.ai.estimate && <p style={{ margin: 0 }}><b>Estimated:</b> {r.ai.estimate}</p>}{r.ai.pitch && <p className="tk-muted">“{r.ai.pitch}”</p>}</div>}
          </div>
          <div className="tk-row" style={{ marginTop: 8 }}>
            {r.website && <Link className="tk-btn sm" href={`/seo-audit?url=${encodeURIComponent(r.website)}`}>Full website audit</Link>}
            <button className="tk-btn sm" onClick={() => { saveToCRM([r]); }}>💾 Save to CRM</button>
            <Link className="tk-btn sm" href={`/proposal?lead=${encodeURIComponent(r.id)}`} onClick={() => saveToCRM([r])}>📄 Proposal</Link>
          </div>
        </td></tr>
      )}
    </>
  );
}

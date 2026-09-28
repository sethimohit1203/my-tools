"use client";
import { useState, useMemo } from "react";
import Link from "next/link";

type Source = "osm" | "google";

// Normalized shape both backends map into, so rendering/export stays source-agnostic.
type Result = {
  id: string;
  name: string;
  address: string;
  phone: string;
  website: string;
  rating: string;
  ratingValue?: number;
  status: string;
  category: string;
  lat?: number;
  lng?: number;
  mapsLink: string;
};

type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  businessStatus?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  currentOpeningHours?: { openNow?: boolean };
  googleMapsUri?: string;
};

type OSMResult = {
  place_id: number;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  class?: string;
  type?: string;
  namedetails?: { name?: string };
  extratags?: Record<string, string>;
};

const PRICE_LABEL: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

const RESULT_LIMIT_OPTIONS = [10, 20, 25, 40, 50, 60];
const RADIUS_OPTIONS = [
  { label: "1 km", meters: 1000 },
  { label: "3 km", meters: 3000 },
  { label: "5 km", meters: 5000 },
  { label: "10 km", meters: 10000 },
  { label: "20 km", meters: 20000 },
];
const PAGE_DELAY_MS = 1500; // brief pause before using a Google pageToken
const LATLNG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

function normalizeGoogle(p: GooglePlace): Result {
  const price = p.priceLevel ? PRICE_LABEL[p.priceLevel] || p.priceLevel : "";
  return {
    id: p.id,
    name: p.displayName?.text || "",
    address: p.formattedAddress || "",
    phone: p.internationalPhoneNumber || p.nationalPhoneNumber || "",
    website: p.websiteUri || "",
    rating: p.rating ? `★ ${p.rating} (${p.userRatingCount || 0})` : "",
    ratingValue: p.rating,
    status: p.currentOpeningHours?.openNow == null
      ? (p.businessStatus || "")
      : (p.currentOpeningHours.openNow ? "Open now" : "Closed now"),
    category: [price, (p.types || [])[0]?.replace(/_/g, " ")].filter(Boolean).join(" · "),
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    mapsLink: p.googleMapsUri || "",
  };
}

function normalizeOSM(r: OSMResult): Result {
  const tags = r.extratags || {};
  return {
    id: String(r.place_id),
    name: r.namedetails?.name || r.display_name.split(",")[0],
    address: r.display_name,
    phone: tags.phone || tags["contact:phone"] || "",
    website: tags.website || tags["contact:website"] || "",
    rating: "",
    status: tags.opening_hours || "",
    category: r.type ? r.type.replace(/_/g, " ") : (r.class || ""),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    mapsLink: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
  };
}

function loadStr(key: string, fallback = "") {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) || fallback;
}
function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; }
}
function saveHistory(query: string) {
  const h = loadJSON<string[]>("gmaps-history", []).filter((q) => q !== query);
  h.unshift(query);
  localStorage.setItem("gmaps-history", JSON.stringify(h.slice(0, 8)));
}

function toCSV(results: Result[]): string {
  const headers = ["Name", "Category", "Address", "Phone", "Website", "Rating", "Status", "Latitude", "Longitude", "Map Link"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = results.map((r) => [
    r.name, r.category, r.address, r.phone, r.website, r.rating, r.status, r.lat, r.lng, r.mapsLink,
  ].map(escape).join(","));
  return [headers.map(escape).join(","), ...rows].join("\n");
}

function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toExcelHTML(results: Result[]): string {
  const headers = ["Name", "Category", "Address", "Phone", "Website", "Rating", "Status", "Map Link"];
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const rows = results.map((r) =>
    `<tr>${[r.name, r.category, r.address, r.phone, r.website, r.rating, r.status, r.mapsLink].map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`
  ).join("");
  return `<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

// ── Theme ──────────────────────────────────────────────────────────
function useTheme(dark: boolean) {
  return dark
    ? { bg: "#0f172a", panel: "#1e293b", border: "#334155", text: "#f1f5f9", sub: "#94a3b8", faint: "#64748b", inputBg: "#0f172a", rowAlt: "#182338", hover: "#243449" }
    : { bg: "#f8fafc", panel: "#ffffff", border: "#e5e7eb", text: "#111827", sub: "#6b7280", faint: "#9ca3af", inputBg: "#ffffff", rowAlt: "#fafafa", hover: "#f3f4f6" };
}
type Theme = ReturnType<typeof useTheme>;

export default function GMapsPage() {
  const [dark, setDark] = useState(() => loadStr("gmaps-dark") === "1");
  const T = useTheme(dark);

  const [tab, setTab] = useState<"search" | "saved">("search");
  const [source, setSource] = useState<Source>(() => (loadStr("gmaps-source", "osm") as Source));
  const [apiKey, setApiKey] = useState(() => loadStr("gmaps-api-key"));
  const [showSettings, setShowSettings] = useState(false);

  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [radiusM, setRadiusM] = useState(5000);
  const [resultLimit, setResultLimit] = useState(25);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");

  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>(() => loadJSON("gmaps-history", []));
  const [saved, setSaved] = useState<Result[]>(() => loadJSON("gmaps-saved", []));

  function toggleDark() {
    setDark((d) => { localStorage.setItem("gmaps-dark", d ? "0" : "1"); return !d; });
  }
  function saveKey(k: string) {
    setApiKey(k);
    localStorage.setItem("gmaps-api-key", k);
  }
  function chooseSource(s: Source) {
    setSource(s);
    localStorage.setItem("gmaps-source", s);
    setResults([]); setSelected(new Set()); setError("");
  }

  function effectiveQuery() {
    const loc = location.trim();
    if (!loc) return query.trim();
    return LATLNG_RE.test(loc) ? query.trim() : `${query.trim()} in ${loc}`;
  }
  function coords(): { lat: number; lng: number } | null {
    const m = location.trim().match(LATLNG_RE);
    return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setError("Geolocation isn't available in this browser."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(`${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`),
      () => setError("Couldn't get your location — check browser permissions.")
    );
  }

  // ── OpenStreetMap: fetched directly from the browser (not our server) ──
  // Nominatim actively blocks requests from cloud/datacenter IPs (which is
  // exactly what a Vercel serverless function looks like to them), so
  // calling it from the visitor's own browser is the documented workaround.
  async function runOSMSearch() {
    const c = coords();
    const params = new URLSearchParams({
      q: effectiveQuery(),
      format: "jsonv2",
      addressdetails: "1",
      namedetails: "1",
      extratags: "1",
      limit: String(Math.min(resultLimit, 40)),
    });
    if (c) {
      const dLat = radiusM / 111000;
      const dLng = radiusM / (111000 * Math.cos((c.lat * Math.PI) / 180) || 1);
      params.set("viewbox", `${c.lng - dLng},${c.lat + dLat},${c.lng + dLng},${c.lat - dLat}`);
      params.set("bounded", "1");
    }
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`OpenStreetMap search failed (${res.status}). Try again in a few seconds — the public server rate-limits busy periods.`);
    const data: OSMResult[] = await res.json();
    setResults(data.map(normalizeOSM));
  }

  // ── Google Places: proxied through our server so the API key + field
  // mask stay in one place; Google doesn't block cloud IPs. ──
  async function fetchGooglePage(pageToken?: string) {
    const body: Record<string, unknown> = { apiKey, query: effectiveQuery(), pageToken };
    const c = coords();
    if (c) { body.latitude = c.lat; body.longitude = c.lng; body.radiusMeters = radiusM; }
    const res = await fetch("/api/gmaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
    return data as { places: GooglePlace[]; nextPageToken: string | null };
  }

  async function runGoogleSearch() {
    const pagesNeeded = Math.min(Math.ceil(resultLimit / 20), 3);
    let all: Result[] = [];
    let token: string | null | undefined = undefined;
    let page = 0;
    do {
      page++;
      setProgress(`Fetching page ${page} of ${pagesNeeded}…`);
      const data = await fetchGooglePage(token || undefined);
      all = all.concat((data.places || []).map(normalizeGoogle));
      setResults([...all].slice(0, resultLimit));
      token = data.nextPageToken;
      if (token && page < pagesNeeded) await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      else break;
    } while (token);
  }

  async function runSearch() {
    if (source === "google" && !apiKey) { setShowSettings(true); setError("Add your Google Places API key first."); return; }
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setResults([]);
    setSelected(new Set());
    saveHistory(query.trim());
    setHistory(loadJSON("gmaps-history", []));

    try {
      if (source === "google") await runGoogleSearch();
      else await runOSMSearch();
      setProgress("");
    } catch (e) {
      setError(String((e as Error).message || e));
      setProgress("");
    }
    setLoading(false);
  }

  const filtered = useMemo(() => results.filter((r) => {
    if (source === "google" && minRating > 0 && (r.ratingValue || 0) < minRating) return false;
    if (source === "google" && openNowOnly && r.status !== "Open now") return false;
    if (categoryFilter.trim() && !r.category.toLowerCase().includes(categoryFilter.trim().toLowerCase())) return false;
    return true;
  }), [results, minRating, openNowOnly, categoryFilter, source]);

  function toggleRow(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => s.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id)));
  }
  function saveSelected() {
    const toSave = filtered.filter((r) => selected.has(r.id));
    const merged = [...saved.filter((s) => !toSave.find((t) => t.id === s.id)), ...toSave];
    setSaved(merged);
    localStorage.setItem("gmaps-saved", JSON.stringify(merged));
    setSelected(new Set());
  }
  function removeSaved(id: string) {
    const merged = saved.filter((s) => s.id !== id);
    setSaved(merged);
    localStorage.setItem("gmaps-saved", JSON.stringify(merged));
  }

  const filenameBase = query.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "export";

  return (
    <main style={{ minHeight: "100vh", background: T.bg, color: T.text }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px 60px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href="/" style={{ fontSize: 13, color: T.sub, textDecoration: "none" }}>← Back</Link>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>🗺️ Maps Business Extractor</h1>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={toggleDark}
              style={{ fontSize: 13, padding: "6px 12px", border: `1px solid ${T.border}`, borderRadius: 8, background: T.panel, cursor: "pointer", color: T.text }}>
              {dark ? "☀️" : "🌙"}
            </button>
            {source === "google" && (
              <button onClick={() => setShowSettings((s) => !s)}
                style={{ fontSize: 12, padding: "6px 14px", border: `1px solid ${T.border}`, borderRadius: 8, background: T.panel, cursor: "pointer", color: T.text }}>
                ⚙ API Key
              </button>
            )}
          </div>
        </div>

        {/* Feature stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 18 }}>
          {[
            { icon: "🆓", title: "OpenStreetMap", sub: "Free · No API key · No charges", color: "#16a34a" },
            { icon: "📍", title: "Google Places", sub: "Most complete data (needs API key)", color: "#6366f1" },
            { icon: "⬇️", title: "Export CSV / Excel", sub: "Download your results in one click", color: "#8b5cf6" },
            { icon: "🎯", title: "Location filter", sub: "Search by city, area, or coordinates", color: "#f59e0b" },
          ].map((c) => (
            <div key={c.title} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: c.color, display: "flex", alignItems: "center", gap: 6 }}>{c.icon} {c.title}</div>
              <div style={{ fontSize: 11, color: T.sub, marginTop: 3 }}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Tabs: Search / Saved */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {(["search", "saved"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "7px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer", border: tab === t ? "2px solid #6366f1" : `1px solid ${T.border}`, background: tab === t ? "#6366f118" : T.panel, color: tab === t ? "#6366f1" : T.sub }}>
              {t === "search" ? "🔍 Search" : `🔖 Saved (${saved.length})`}
            </button>
          ))}
        </div>

        {tab === "search" ? (
          <>
            {/* Source switcher */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button onClick={() => chooseSource("osm")}
                style={{ flex: 1, padding: "10px 14px", borderRadius: 10, cursor: "pointer", textAlign: "left", border: source === "osm" ? "2px solid #16a34a" : `1px solid ${T.border}`, background: source === "osm" ? (dark ? "#16a34a22" : "#f0fdf4") : T.panel }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: source === "osm" ? "#16a34a" : T.text }}>🆓 OpenStreetMap</div>
                <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>Free & reliable — no API key</div>
              </button>
              <button onClick={() => chooseSource("google")}
                style={{ flex: 1, padding: "10px 14px", borderRadius: 10, cursor: "pointer", textAlign: "left", border: source === "google" ? "2px solid #6366f1" : `1px solid ${T.border}`, background: source === "google" ? (dark ? "#6366f122" : "#eef2ff") : T.panel }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: source === "google" ? "#6366f1" : T.text }}>📍 Google Places</div>
                <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>More detailed — needs API key</div>
              </button>
            </div>

            {source === "osm" ? (
              <InfoBanner T={T} tone="green">
                Uses OpenStreetMap&apos;s free public <strong>Nominatim</strong> search, called directly from your browser — no key, no charges. Data is community-contributed, so phone/website/hours only show where someone tagged them. Please keep searches light (shared public server). Data © OpenStreetMap contributors (ODbL).
              </InfoBanner>
            ) : (
              <InfoBanner T={T} tone="indigo">
                Pulls data through the official <strong>Google Places API (Text Search)</strong> — not by scraping maps.google.com. Google gives a limited number of free calls per SKU each month, then bills per request. See{" "}
                <a href="https://developers.google.com/maps/documentation/places/web-service/text-search" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>pricing docs</a>.
              </InfoBanner>
            )}

            {source === "google" && showSettings && (
              <Panel T={T}>
                <label style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 4 }}>Google Places API Key</label>
                <input style={inputSt(T)} type="password" placeholder="AIza..." value={apiKey} onChange={(e) => saveKey(e.target.value)} />
                <p style={{ fontSize: 11, color: T.faint, marginTop: 6 }}>
                  Get one at <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1" }}>console.cloud.google.com</a> — enable &quot;Places API (New)&quot;. Stored only in your browser&apos;s localStorage.
                </p>
              </Panel>
            )}

            {/* Search form */}
            <Panel T={T}>
              <label style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 4 }}>Search query *</label>
              <input style={inputSt(T)} placeholder='e.g. "coffee shop" or "plumbers"'
                value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }} />
              <p style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>What kind of business — combine with Location below, e.g. &quot;coffee shop&quot; + &quot;Geeta Colony, Delhi&quot;.</p>

              {history.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {history.map((h) => (
                    <button key={h} onClick={() => setQuery(h)}
                      style={{ fontSize: 11, padding: "4px 10px", border: `1px solid ${T.border}`, borderRadius: 20, background: T.hover, cursor: "pointer", color: T.sub }}>
                      {h}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginTop: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 4 }}>Location (optional)</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input style={inputSt(T)} placeholder="City, area, or lat,lng" value={location} onChange={(e) => setLocation(e.target.value)} />
                    <button onClick={useMyLocation} title="Use my location"
                      style={{ padding: "0 12px", border: `1px solid ${T.border}`, borderRadius: 8, background: T.panel, cursor: "pointer", color: T.text }}>🎯</button>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 4 }}>Radius</label>
                  <select style={inputSt(T)} value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))}>
                    {RADIUS_OPTIONS.map((r) => <option key={r.meters} value={r.meters}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: T.sub, display: "block", marginBottom: 4 }}>Results limit</label>
                  <select style={inputSt(T)} value={resultLimit} onChange={(e) => setResultLimit(Number(e.target.value))}>
                    {RESULT_LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n} results</option>)}
                  </select>
                </div>
              </div>
              {!LATLNG_RE.test(location.trim()) && location.trim() && (
                <p style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>Radius only applies with exact coordinates (lat,lng) — otherwise the location name is folded into the query text.</p>
              )}

              <button onClick={() => setShowAdvanced((s) => !s)}
                style={{ marginTop: 14, fontSize: 12, background: "none", border: "none", color: "#6366f1", cursor: "pointer", padding: 0, fontWeight: 600 }}>
                {showAdvanced ? "▾" : "▸"} Advanced filters (rating, hours, category)
              </button>
              {showAdvanced && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: T.sub, display: "block", marginBottom: 3 }}>Min rating {source === "osm" && "(Google only)"}</label>
                    <select style={inputSt(T)} value={minRating} onChange={(e) => setMinRating(Number(e.target.value))} disabled={source === "osm"}>
                      <option value={0}>Any</option>
                      <option value={3}>★ 3.0+</option>
                      <option value={4}>★ 4.0+</option>
                      <option value={4.5}>★ 4.5+</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: T.sub, display: "block", marginBottom: 3 }}>Category contains</label>
                    <input style={inputSt(T)} placeholder="e.g. cafe" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} />
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 8, gap: 6 }}>
                    <input type="checkbox" id="openNow" checked={openNowOnly} onChange={(e) => setOpenNowOnly(e.target.checked)} disabled={source === "osm"} />
                    <label htmlFor="openNow" style={{ fontSize: 12, color: T.sub }}>Open now {source === "osm" && "(Google only)"}</label>
                  </div>
                </div>
              )}

              <button onClick={runSearch} disabled={loading || !query.trim()}
                style={{ marginTop: 18, width: "100%", padding: "12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: loading || !query.trim() ? 0.6 : 1 }}>
                {loading ? (progress || "Searching…") : "🔍 Extract Business Data"}
              </button>

              {error && (
                <div style={{ marginTop: 12, background: dark ? "#7f1d1d33" : "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: dark ? "#fca5a5" : "#991b1b" }}>
                  {error}
                </div>
              )}
            </Panel>

            <ResultsTable
              T={T} dark={dark} results={filtered} total={results.length} loading={loading}
              selected={selected} onToggleRow={toggleRow} onToggleAll={toggleAll}
              onSaveSelected={saveSelected}
              onExportCSV={() => downloadBlob(toCSV(filtered), "text/csv;charset=utf-8;", `maps-extract-${filenameBase}.csv`)}
              onExportExcel={() => downloadBlob(toExcelHTML(filtered), "application/vnd.ms-excel", `maps-extract-${filenameBase}.xls`)}
              onClear={() => { setResults([]); setSelected(new Set()); }}
              emptyHint="Run a search to extract business data — name, address, phone, website, rating, and hours."
            />
          </>
        ) : (
          <ResultsTable
            T={T} dark={dark} results={saved} total={saved.length} loading={false}
            selected={new Set()} onToggleRow={removeSaved} onToggleAll={() => {}}
            removeMode
            onExportCSV={() => downloadBlob(toCSV(saved), "text/csv;charset=utf-8;", "maps-extract-saved.csv")}
            onExportExcel={() => downloadBlob(toExcelHTML(saved), "application/vnd.ms-excel", "maps-extract-saved.xls")}
            onClear={() => { setSaved([]); localStorage.setItem("gmaps-saved", "[]"); }}
            emptyHint="Nothing saved yet — select rows on the Search tab and click Save selected."
          />
        )}
      </div>
    </main>
  );
}

function inputSt(T: Theme): React.CSSProperties {
  return {
    width: "100%", padding: "8px 12px", border: `1px solid ${T.border}`,
    borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: T.inputBg, color: T.text,
  };
}

function Panel({ T, children }: { T: Theme; children: React.ReactNode }) {
  return <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, marginBottom: 18 }}>{children}</div>;
}

function InfoBanner({ T, tone, children }: { T: Theme; tone: "green" | "indigo"; children: React.ReactNode }) {
  const bg = tone === "green" ? (T.bg === "#0f172a" ? "#16a34a22" : "#f0fdf4") : (T.bg === "#0f172a" ? "#6366f122" : "#eef2ff");
  const border = tone === "green" ? "#86efac" : "#c7d2fe";
  const color = tone === "green" ? "#16a34a" : "#6366f1";
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color, marginBottom: 18, lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

function ResultsTable({
  T, dark, results, total, loading, selected, onToggleRow, onToggleAll, onSaveSelected, removeMode,
  onExportCSV, onExportExcel, onClear, emptyHint,
}: {
  T: Theme; dark: boolean; results: Result[]; total: number; loading: boolean;
  selected: Set<string>; onToggleRow: (id: string) => void; onToggleAll: () => void;
  onSaveSelected?: () => void; removeMode?: boolean;
  onExportCSV: () => void; onExportExcel: () => void; onClear: () => void; emptyHint: string;
}) {
  if (results.length === 0) {
    return (
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: "50px 24px", textAlign: "center", color: T.faint }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📍</div>
        {emptyHint}
      </div>
    );
  }
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: T.sub }}>
          {results.length}{total !== results.length ? ` of ${total}` : ""} result{results.length === 1 ? "" : "s"}{loading ? " (still fetching…)" : ""}
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onSaveSelected && selected.size > 0 && (
            <button onClick={onSaveSelected}
              style={{ fontSize: 12, padding: "6px 16px", background: "#eef2ff", color: "#6366f1", border: "1px solid #c7d2fe", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
              🔖 Save selected ({selected.size})
            </button>
          )}
          <button onClick={onExportCSV}
            style={{ fontSize: 12, padding: "6px 16px", background: dark ? "#16a34a22" : "#f0fdf4", color: "#16a34a", border: "1px solid #86efac", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            ⬇ CSV
          </button>
          <button onClick={onExportExcel}
            style={{ fontSize: 12, padding: "6px 16px", background: dark ? "#8b5cf622" : "#f5f3ff", color: "#7c3aed", border: "1px solid #c4b5fd", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            ⬇ Excel
          </button>
          <button onClick={onClear}
            style={{ fontSize: 12, padding: "6px 16px", background: T.panel, color: T.sub, border: `1px solid ${T.border}`, borderRadius: 8, cursor: "pointer" }}>
            Clear
          </button>
        </div>
      </div>

      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: T.hover, borderBottom: `1px solid ${T.border}` }}>
              <th style={{ padding: "10px 14px", width: 30 }}>
                {!removeMode && <input type="checkbox" checked={selected.size === results.length} onChange={onToggleAll} />}
              </th>
              {["Name", "Category", "Address", "Phone", "Website", "Rating", "Status", ""].map((h) => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: T.sub, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}`, background: i % 2 === 0 ? T.panel : T.rowAlt }}>
                <td style={{ padding: "10px 14px" }}>
                  {removeMode
                    ? <button onClick={() => onToggleRow(r.id)} title="Remove" style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>✕</button>
                    : <input type="checkbox" checked={selected.has(r.id)} onChange={() => onToggleRow(r.id)} />}
                </td>
                <td style={{ padding: "10px 14px", fontWeight: 500, maxWidth: 200 }}>{r.name || "—"}</td>
                <td style={{ padding: "10px 14px", color: T.sub, whiteSpace: "nowrap" }}>{r.category || "—"}</td>
                <td style={{ padding: "10px 14px", color: T.sub, maxWidth: 240 }}>{r.address || "—"}</td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{r.phone || "—"}</td>
                <td style={{ padding: "10px 14px", maxWidth: 160 }}>
                  {r.website ? <a href={r.website} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", textDecoration: "none" }}>Visit ↗</a> : "—"}
                </td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{r.rating || "—"}</td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{r.status || "—"}</td>
                <td style={{ padding: "10px 14px" }}>
                  {r.mapsLink ? <a href={r.mapsLink} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", textDecoration: "none" }}>Map ↗</a> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

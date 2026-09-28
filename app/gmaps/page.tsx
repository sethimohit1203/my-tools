"use client";
import { useState } from "react";
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

const MAX_PAGES = 3; // Google Text Search (New) caps at 3 pages / 60 results per query
const PAGE_DELAY_MS = 2000; // brief pause before using a Google pageToken

function normalizeGoogle(p: GooglePlace): Result {
  const price = p.priceLevel ? PRICE_LABEL[p.priceLevel] || p.priceLevel : "";
  return {
    id: p.id,
    name: p.displayName?.text || "",
    address: p.formattedAddress || "",
    phone: p.internationalPhoneNumber || p.nationalPhoneNumber || "",
    website: p.websiteUri || "",
    rating: p.rating ? `★ ${p.rating} (${p.userRatingCount || 0})` : "",
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

function loadKey() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("gmaps-api-key") || "";
}

function loadHistory(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("gmaps-history") || "[]"); }
  catch { return []; }
}

function saveHistory(query: string) {
  const h = loadHistory().filter((q) => q !== query);
  h.unshift(query);
  localStorage.setItem("gmaps-history", JSON.stringify(h.slice(0, 8)));
}

function loadSource(): Source {
  if (typeof window === "undefined") return "osm";
  return (localStorage.getItem("gmaps-source") as Source) || "osm";
}

const inputSt: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #e5e7eb",
  borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff", color: "#111",
};

function toCSV(results: Result[]): string {
  const headers = ["Name", "Address", "Phone", "Website", "Rating", "Status", "Category", "Latitude", "Longitude", "Map Link"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = results.map((r) => [
    r.name, r.address, r.phone, r.website, r.rating, r.status, r.category, r.lat, r.lng, r.mapsLink,
  ].map(escape).join(","));
  return [headers.map(escape).join(","), ...rows].join("\n");
}

export default function GMapsPage() {
  const [source, setSource] = useState<Source>(() => loadSource());
  const [apiKey, setApiKey] = useState(() => loadKey());
  const [showSettings, setShowSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [useLocation, setUseLocation] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("5000");
  const [fetchAll, setFetchAll] = useState(true);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>(() => loadHistory());

  function saveKey(k: string) {
    setApiKey(k);
    localStorage.setItem("gmaps-api-key", k);
  }

  function chooseSource(s: Source) {
    setSource(s);
    localStorage.setItem("gmaps-source", s);
  }

  async function fetchGooglePage(pageToken?: string) {
    const body: Record<string, unknown> = { apiKey, query, pageToken };
    if (useLocation && lat && lng) {
      body.latitude = parseFloat(lat);
      body.longitude = parseFloat(lng);
      body.radiusMeters = parseFloat(radius) || 5000;
    }
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
    let all: Result[] = [];
    let token: string | null | undefined = undefined;
    let page = 0;
    do {
      page++;
      setProgress(`Fetching page ${page}…`);
      const data = await fetchGooglePage(token || undefined);
      all = all.concat((data.places || []).map(normalizeGoogle));
      setResults([...all]);
      token = data.nextPageToken;
      if (fetchAll && token && page < MAX_PAGES) {
        setProgress(`Fetching page ${page + 1} of up to ${MAX_PAGES}…`);
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      } else {
        break;
      }
    } while (token);
  }

  async function runOSMSearch() {
    const fullQuery = useLocation && lat && lng ? `${query} near ${lat},${lng}` : query;
    const res = await fetch("/api/gmaps/osm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: fullQuery, limit: 40 }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
    setResults((data.results || []).map(normalizeOSM));
  }

  async function runSearch() {
    if (source === "google" && !apiKey) { setShowSettings(true); setError("Add your Google Places API key first."); return; }
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setResults([]);
    saveHistory(query.trim());
    setHistory(loadHistory());

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

  function exportCSV() {
    const csv = toCSV(results);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `maps-extract-${query.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link href="/" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>← Back</Link>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>🗺️ Maps Business Extractor</h1>
        </div>
        {source === "google" && (
          <button onClick={() => setShowSettings((s) => !s)}
            style={{ fontSize: 12, padding: "6px 14px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: "pointer", color: "#374151" }}>
            ⚙ API Key
          </button>
        )}
      </div>

      {/* Source switcher */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => chooseSource("osm")}
          style={{ flex: 1, padding: "10px 14px", borderRadius: 10, cursor: "pointer", textAlign: "left", border: source === "osm" ? "2px solid #16a34a" : "1px solid #e5e7eb", background: source === "osm" ? "#f0fdf4" : "#fff" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: source === "osm" ? "#16a34a" : "#111" }}>🆓 OpenStreetMap</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Free, no API key, no billing. Coverage & detail vary by area.</div>
        </button>
        <button onClick={() => chooseSource("google")}
          style={{ flex: 1, padding: "10px 14px", borderRadius: 10, cursor: "pointer", textAlign: "left", border: source === "google" ? "2px solid #6366f1" : "1px solid #e5e7eb", background: source === "google" ? "#eef2ff" : "#fff" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: source === "google" ? "#6366f1" : "#111" }}>📍 Google Places</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Most complete data. Needs your API key; billed past free monthly quota.</div>
        </button>
      </div>

      {source === "osm" ? (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#166534", marginBottom: 18 }}>
          Uses OpenStreetMap&apos;s free public <strong>Nominatim</strong> search — no key, no charges. Data is community-contributed, so phone/website/hours are only present where someone tagged them; coverage is generally weaker than Google in less-mapped areas. Please keep searches light (this is a shared public server) — for heavy use, self-host Nominatim. Data © OpenStreetMap contributors (ODbL).
        </div>
      ) : (
        <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#4338ca", marginBottom: 18 }}>
          Pulls data through the official <strong>Google Places API (Text Search)</strong> — not by scraping maps.google.com. Google gives a limited number of free calls per SKU each month (check your Cloud Console for current quotas), then bills per request — phone/website/rating fields fall under the &quot;Pro&quot; SKU. See{" "}
          <a href="https://developers.google.com/maps/documentation/places/web-service/text-search" target="_blank" rel="noopener noreferrer" style={{ color: "#4338ca", textDecoration: "underline" }}>
            Google&apos;s pricing docs
          </a>.
        </div>
      )}

      {source === "google" && showSettings && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Google Places API Key</label>
          <input style={inputSt} type="password" placeholder="AIza..." value={apiKey} onChange={(e) => saveKey(e.target.value)} />
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
            Get one at <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1" }}>console.cloud.google.com</a> — enable &quot;Places API (New)&quot; on the project. Stored only in your browser&apos;s localStorage.
          </p>
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Search query</label>
        <input style={inputSt} placeholder='e.g. "coffee shops in Austin, TX" or "plumbers near me"'
          value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }} />

        {history.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {history.map((h) => (
              <button key={h} onClick={() => setQuery(h)}
                style={{ fontSize: 11, padding: "4px 10px", border: "1px solid #e5e7eb", borderRadius: 20, background: "#f9fafb", cursor: "pointer", color: "#374151" }}>
                {h}
              </button>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" id="useLoc" checked={useLocation} onChange={(e) => setUseLocation(e.target.checked)} />
          <label htmlFor="useLoc" style={{ fontSize: 12, color: "#374151" }}>Bias results to a specific location (lat/lng)</label>
        </div>
        {useLocation && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>Latitude</label>
              <input style={inputSt} placeholder="30.2672" value={lat} onChange={(e) => setLat(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>Longitude</label>
              <input style={inputSt} placeholder="-97.7431" value={lng} onChange={(e) => setLng(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>Radius (meters){source === "osm" ? " — ignored" : ""}</label>
              <input style={inputSt} placeholder="5000" value={radius} onChange={(e) => setRadius(e.target.value)} disabled={source === "osm"} />
            </div>
          </div>
        )}

        {source === "google" && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" id="fetchAll" checked={fetchAll} onChange={(e) => setFetchAll(e.target.checked)} />
            <label htmlFor="fetchAll" style={{ fontSize: 12, color: "#374151" }}>Auto-fetch up to {MAX_PAGES} pages (~60 results)</label>
          </div>
        )}

        <button onClick={runSearch} disabled={loading || !query.trim()}
          style={{ marginTop: 16, padding: "10px 24px", background: source === "osm" ? "#16a34a" : "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: loading || !query.trim() ? 0.6 : 1 }}>
          {loading ? (progress || "Searching…") : "🔍 Extract Data"}
        </button>

        {error && (
          <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#991b1b" }}>
            {error}
          </div>
        )}
      </div>

      {results.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: "#6b7280" }}>{results.length} results{loading ? " (still fetching…)" : ""}</span>
            <button onClick={exportCSV}
              style={{ fontSize: 12, padding: "6px 16px", background: "#f0fdf4", color: "#16a34a", border: "1px solid #86efac", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
              ⬇ Export CSV
            </button>
          </div>

          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  {["Name", "Address", "Phone", "Website", "Rating", "Status", "Map"].map((h) => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 500, maxWidth: 200 }}>{r.name || "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#6b7280", maxWidth: 240 }}>{r.address || "—"}</td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{r.phone || "—"}</td>
                    <td style={{ padding: "10px 14px", maxWidth: 160 }}>
                      {r.website ? <a href={r.website} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", textDecoration: "none" }}>Visit ↗</a> : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{r.rating || "—"}</td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{r.status || "—"}</td>
                    <td style={{ padding: "10px 14px" }}>
                      {r.mapsLink ? <a href={r.mapsLink} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", textDecoration: "none" }}>Open ↗</a> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && results.length === 0 && !error && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "50px 24px", textAlign: "center", color: "#9ca3af" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📍</div>
          Run a search to extract business data — name, address, phone, website, rating, and hours.
        </div>
      )}
    </main>
  );
}

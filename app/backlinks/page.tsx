"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

type Status = "pending" | "submitted" | "live" | "indexed";

type BacklinkEntry = {
  id: string;
  site: string;
  url: string;
  category: "profile" | "social" | "web20" | "directory" | "article";
  status: Status;
  da: number;
  dateSubmitted?: string;
  notes?: string;
  targetSite: string;
};

type TargetSite = {
  id: string;
  name: string;
  url: string;
  target: number;
  color: string;
};

const CATEGORIES = {
  profile:   { label: "Profile Creation", color: "#6366f1", icon: "👤" },
  social:    { label: "Social Bookmarking", color: "#10b981", icon: "🔖" },
  web20:     { label: "Web 2.0 Blogs", color: "#f59e0b", icon: "📝" },
  directory: { label: "Business Directory", color: "#ec4899", icon: "📋" },
  article:   { label: "Article / PDF", color: "#8b5cf6", icon: "📄" },
};

const STATUS_CONFIG = {
  pending:   { label: "Pending",   color: "#9ca3af", bg: "#f9fafb" },
  submitted: { label: "Submitted", color: "#f59e0b", bg: "#fffbeb" },
  live:      { label: "Live",      color: "#10b981", bg: "#f0fdf4" },
  indexed:   { label: "Indexed",   color: "#6366f1", bg: "#eef2ff" },
};

const SAMPLE_SITES_PRORIDO: Omit<BacklinkEntry, "id" | "targetSite">[] = [
  { site: "GitHub", url: "https://github.com", category: "profile", status: "pending", da: 95, notes: "Create company profile" },
  { site: "Crunchbase", url: "https://crunchbase.com", category: "profile", status: "pending", da: 92, notes: "Add business listing" },
  { site: "About.me", url: "https://about.me", category: "profile", status: "pending", da: 87 },
  { site: "Medium", url: "https://medium.com", category: "web20", status: "pending", da: 95, notes: "Write article about luxury cabs" },
  { site: "Blogger", url: "https://blogger.com", category: "web20", status: "pending", da: 99 },
  { site: "WordPress.com", url: "https://wordpress.com", category: "web20", status: "pending", da: 99 },
  { site: "Tumblr", url: "https://tumblr.com", category: "social", status: "pending", da: 99 },
  { site: "Diigo", url: "https://diigo.com", category: "social", status: "pending", da: 78 },
  { site: "Mix", url: "https://mix.com", category: "social", status: "pending", da: 82 },
  { site: "Flipboard", url: "https://flipboard.com", category: "social", status: "pending", da: 91 },
  { site: "Scoop.it", url: "https://scoop.it", category: "social", status: "pending", da: 79 },
  { site: "Justdial", url: "https://justdial.com", category: "directory", status: "pending", da: 72, notes: "India business directory" },
  { site: "Sulekha", url: "https://sulekha.com", category: "directory", status: "pending", da: 68, notes: "India local directory" },
  { site: "IndiaMART", url: "https://indiamart.com", category: "directory", status: "pending", da: 75 },
  { site: "Yellow Pages India", url: "https://yellowpages.co.in", category: "directory", status: "pending", da: 55 },
  { site: "SlideShare", url: "https://slideshare.net", category: "article", status: "pending", da: 95, notes: "Upload PDF about luxury travel" },
  { site: "Scribd", url: "https://scribd.com", category: "article", status: "pending", da: 94 },
  { site: "Issuu", url: "https://issuu.com", category: "article", status: "pending", da: 93 },
];

function genId() {
  return Math.random().toString(36).substr(2, 9);
}

function loadData(): { sites: TargetSite[]; links: BacklinkEntry[] } {
  if (typeof window === "undefined") return { sites: [], links: [] };
  try {
    const sites = JSON.parse(localStorage.getItem("bl-sites") || "[]");
    const links = JSON.parse(localStorage.getItem("bl-links") || "[]");
    return { sites, links };
  } catch { return { sites: [], links: [] }; }
}

function saveData(sites: TargetSite[], links: BacklinkEntry[]) {
  localStorage.setItem("bl-sites", JSON.stringify(sites));
  localStorage.setItem("bl-links", JSON.stringify(links));
}

export default function BacklinksPage() {
  const [sites, setSites] = useState<TargetSite[]>([]);
  const [links, setLinks] = useState<BacklinkEntry[]>([]);
  const [activeSite, setActiveSite] = useState<string>("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [activeStatus, setActiveStatus] = useState<string>("all");
  const [showAddSite, setShowAddSite] = useState(false);
  const [showAddLink, setShowAddLink] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newSite, setNewSite] = useState({ name: "", url: "", target: "500", color: "#6366f1" });
  const [newLink, setNewLink] = useState({ site: "", url: "", category: "profile", da: "", notes: "" });
  const [search, setSearch] = useState("");

  useEffect(() => {
    const { sites: s, links: l } = loadData();
    setSites(s);
    setLinks(l);
    if (s.length > 0) setActiveSite(s[0].id);
  }, []);

  function persist(s: TargetSite[], l: BacklinkEntry[]) {
    setSites(s);
    setLinks(l);
    saveData(s, l);
  }

  function addSite() {
    if (!newSite.name || !newSite.url) return;
    const site: TargetSite = { id: genId(), name: newSite.name, url: newSite.url, target: parseInt(newSite.target) || 500, color: newSite.color };
    const updated = [...sites, site];
    persist(updated, links);
    setActiveSite(site.id);
    setNewSite({ name: "", url: "", target: "500", color: "#6366f1" });
    setShowAddSite(false);
  }

  function importSampleData() {
    if (!activeSite) return;
    const newLinks: BacklinkEntry[] = SAMPLE_SITES_PRORIDO.map((l) => ({ ...l, id: genId(), targetSite: activeSite }));
    const updated = [...links.filter((l) => l.targetSite !== activeSite || !newLinks.find((nl) => nl.site === l.site)), ...newLinks];
    persist(sites, updated);
    setShowImport(false);
  }

  function addLink() {
    if (!newLink.site || !activeSite) return;
    const entry: BacklinkEntry = {
      id: genId(), targetSite: activeSite,
      site: newLink.site, url: newLink.url,
      category: newLink.category as BacklinkEntry["category"],
      status: "pending", da: parseInt(newLink.da) || 0,
      notes: newLink.notes,
    };
    persist(sites, [...links, entry]);
    setNewLink({ site: "", url: "", category: "profile", da: "", notes: "" });
    setShowAddLink(false);
  }

  function updateStatus(id: string, status: Status) {
    const updated = links.map((l) => l.id === id ? {
      ...l, status,
      dateSubmitted: status === "submitted" && !l.dateSubmitted ? new Date().toISOString().split("T")[0] : l.dateSubmitted,
    } : l);
    persist(sites, updated);
  }

  function deleteLink(id: string) {
    persist(sites, links.filter((l) => l.id !== id));
  }

  const currentSite = sites.find((s) => s.id === activeSite);
  const siteLinks = links.filter((l) => l.targetSite === activeSite);
  const filtered = siteLinks.filter((l) => {
    if (activeCategory !== "all" && l.category !== activeCategory) return false;
    if (activeStatus !== "all" && l.status !== activeStatus) return false;
    if (search && !l.site.toLowerCase().includes(search.toLowerCase()) && !l.url.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: siteLinks.length,
    pending: siteLinks.filter((l) => l.status === "pending").length,
    submitted: siteLinks.filter((l) => l.status === "submitted").length,
    live: siteLinks.filter((l) => l.status === "live").length,
    indexed: siteLinks.filter((l) => l.status === "indexed").length,
  };

  const progress = currentSite ? Math.round((stats.live + stats.indexed) / currentSite.target * 100) : 0;

  const inputSt: React.CSSProperties = { width: "100%", padding: "7px 10px", border: "1px solid #e5e7eb", borderRadius: 7, fontSize: 13, fontFamily: "inherit", background: "#fff", color: "#111" };

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 20px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link href="/" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>← Back</Link>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>🔗 Backlink Tracker</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowAddSite(true)}
            style={{ fontSize: 13, padding: "7px 14px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 500 }}>
            + Add Site
          </button>
          {activeSite && (
            <>
              <button onClick={() => setShowImport(true)}
                style={{ fontSize: 13, padding: "7px 14px", background: "#f0fdf4", color: "#16a34a", border: "1px solid #86efac", borderRadius: 8, cursor: "pointer", fontWeight: 500 }}>
                ⚡ Import 18 starter sites
              </button>
              <button onClick={() => setShowAddLink(true)}
                style={{ fontSize: 13, padding: "7px 14px", background: "#fff", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 8, cursor: "pointer" }}>
                + Add Link
              </button>
            </>
          )}
        </div>
      </div>

      {/* Site tabs */}
      {sites.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {sites.map((s) => (
            <button key={s.id} onClick={() => setActiveSite(s.id)}
              style={{ padding: "7px 16px", borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: "pointer", border: activeSite === s.id ? `2px solid ${s.color}` : "1px solid #e5e7eb", background: activeSite === s.id ? s.color + "15" : "#fff", color: activeSite === s.id ? s.color : "#6b7280" }}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {sites.length === 0 && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "60px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔗</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No sites yet</h2>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>Add your first site to start tracking backlinks.</p>
          <button onClick={() => setShowAddSite(true)}
            style={{ padding: "10px 24px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            + Add Site
          </button>
        </div>
      )}

      {/* Stats row */}
      {currentSite && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Target", value: currentSite.target, color: "#6b7280", bg: "#f9fafb" },
            { label: "Total Added", value: stats.total, color: "#374151", bg: "#f3f4f6" },
            { label: "Submitted", value: stats.submitted, color: "#d97706", bg: "#fffbeb" },
            { label: "Live", value: stats.live, color: "#10b981", bg: "#f0fdf4" },
            { label: "Indexed", value: stats.indexed, color: "#6366f1", bg: "#eef2ff" },
          ].map((s) => (
            <div key={s.label} style={{ background: s.bg, border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
          {/* Progress bar */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px", gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Progress to target ({currentSite.target} links)</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: currentSite.color }}>{progress}%</span>
            </div>
            <div style={{ height: 8, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(progress, 100)}%`, background: currentSite.color, borderRadius: 4, transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>{stats.live + stats.indexed} live/indexed out of {currentSite.target} target</div>
          </div>
        </div>
      )}

      {/* Filters */}
      {currentSite && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sites..."
            style={{ ...inputSt, width: 180 }} />
          <select value={activeCategory} onChange={(e) => setActiveCategory(e.target.value)} style={{ ...inputSt, width: "auto" }}>
            <option value="all">All categories</option>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
          <select value={activeStatus} onChange={(e) => setActiveStatus(e.target.value)} style={{ ...inputSt, width: "auto" }}>
            <option value="all">All statuses</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>{filtered.length} entries</span>
        </div>
      )}

      {/* Category pills */}
      {currentSite && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {Object.entries(CATEGORIES).map(([k, v]) => {
            const count = siteLinks.filter((l) => l.category === k).length;
            const liveCount = siteLinks.filter((l) => l.category === k && (l.status === "live" || l.status === "indexed")).length;
            return (
              <button key={k} onClick={() => setActiveCategory(activeCategory === k ? "all" : k)}
                style={{ fontSize: 11, padding: "5px 12px", borderRadius: 20, cursor: "pointer", border: activeCategory === k ? `2px solid ${v.color}` : "1px solid #e5e7eb", background: activeCategory === k ? v.color + "15" : "#fff", color: activeCategory === k ? v.color : "#6b7280", fontWeight: 500 }}>
                {v.icon} {v.label} · {liveCount}/{count}
              </button>
            );
          })}
        </div>
      )}

      {/* Links table */}
      {currentSite && filtered.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Site</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Category</th>
                <th style={{ padding: "10px 14px", textAlign: "center", fontWeight: 600, color: "#374151" }}>DA</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Status</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Date</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Notes</th>
                <th style={{ padding: "10px 14px", textAlign: "center", fontWeight: 600, color: "#374151" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((link, i) => {
                const cat = CATEGORIES[link.category];
                const st = STATUS_CONFIG[link.status];
                return (
                  <tr key={link.id} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <a href={link.url} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", textDecoration: "none", fontWeight: 500 }}>
                        {link.site} ↗
                      </a>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: cat.color + "18", color: cat.color, fontWeight: 500 }}>
                        {cat.icon} {cat.label}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center", fontWeight: 600, color: link.da >= 80 ? "#10b981" : link.da >= 50 ? "#f59e0b" : "#9ca3af" }}>
                      {link.da || "—"}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <select value={link.status} onChange={(e) => updateStatus(link.id, e.target.value as Status)}
                        style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: `1px solid ${st.color}40`, background: st.bg, color: st.color, fontWeight: 600, cursor: "pointer" }}>
                        {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#9ca3af", fontSize: 12 }}>{link.dateSubmitted || "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#6b7280", fontSize: 12, maxWidth: 150 }}>{link.notes || "—"}</td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <button onClick={() => deleteLink(link.id)}
                        style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {currentSite && filtered.length === 0 && siteLinks.length === 0 && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "40px", textAlign: "center" }}>
          <p style={{ color: "#9ca3af", marginBottom: 16 }}>No backlinks added yet for {currentSite.name}</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button onClick={() => setShowImport(true)}
              style={{ padding: "8px 18px", background: "#f0fdf4", color: "#16a34a", border: "1px solid #86efac", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
              ⚡ Import 18 starter sites
            </button>
            <button onClick={() => setShowAddLink(true)}
              style={{ padding: "8px 18px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
              + Add manually
            </button>
          </div>
        </div>
      )}

      {/* ADD SITE MODAL */}
      {showAddSite && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>Add new site</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Site name</label>
                <input style={inputSt} placeholder="ProRido" value={newSite.name} onChange={(e) => setNewSite((s) => ({ ...s, name: e.target.value }))} /></div>
              <div><label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>URL</label>
                <input style={inputSt} placeholder="https://prorido.com" value={newSite.url} onChange={(e) => setNewSite((s) => ({ ...s, url: e.target.value }))} /></div>
              <div><label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Backlink target</label>
                <input style={inputSt} placeholder="500" value={newSite.target} onChange={(e) => setNewSite((s) => ({ ...s, target: e.target.value }))} /></div>
              <div><label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Color</label>
                <input type="color" value={newSite.color} onChange={(e) => setNewSite((s) => ({ ...s, color: e.target.value }))} style={{ height: 36, width: "100%", borderRadius: 7, border: "1px solid #e5e7eb", cursor: "pointer" }} /></div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button onClick={addSite} style={{ flex: 1, padding: "9px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Add Site</button>
              <button onClick={() => setShowAddSite(false)} style={{ flex: 1, padding: "9px", background: "#f9fafb", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* IMPORT MODAL */}
      {showImport && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, width: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>⚡ Import starter backlink sites</h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>This will add 18 pre-filled high-DA sites across all 5 categories for <strong>{currentSite?.name}</strong>. You can edit or delete any of them after.</p>
            <div style={{ background: "#f9fafb", borderRadius: 8, padding: 12, marginBottom: 20, fontSize: 12, color: "#374151" }}>
              <div>👤 3 Profile sites (DA 87–95)</div>
              <div>🔖 5 Social bookmarking (DA 78–99)</div>
              <div>📝 3 Web 2.0 blogs (DA 95–99)</div>
              <div>📋 4 Business directories (DA 55–75)</div>
              <div>📄 3 Article/PDF sites (DA 93–95)</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={importSampleData} style={{ flex: 1, padding: "9px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Import All 18</button>
              <button onClick={() => setShowImport(false)} style={{ flex: 1, padding: "9px", background: "#f9fafb", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD LINK MODAL */}
      {showAddLink && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>Add backlink site</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Site name</label>
                <input style={inputSt} placeholder="GitHub" value={newLink.site} onChange={(e) => setNewLink((l) => ({ ...l, site: e.target.value }))} /></div>
              <div><label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>URL</label>
                <input style={inputSt} placeholder="https://github.com" value={newLink.url} onChange={(e) => setNewLink((l) => ({ ...l, url: e.target.value }))} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Category</label>
                  <select style={inputSt} value={newLink.category} onChange={(e) => setNewLink((l) => ({ ...l, category: e.target.value }))}>
                    {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select></div>
                <div><label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>DA score</label>
                  <input style={inputSt} placeholder="85" value={newLink.da} onChange={(e) => setNewLink((l) => ({ ...l, da: e.target.value }))} /></div>
              </div>
              <div><label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Notes</label>
                <input style={inputSt} placeholder="Optional notes..." value={newLink.notes} onChange={(e) => setNewLink((l) => ({ ...l, notes: e.target.value }))} /></div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button onClick={addLink} style={{ flex: 1, padding: "9px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Add</button>
              <button onClick={() => setShowAddLink(false)} style={{ flex: 1, padding: "9px", background: "#f9fafb", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
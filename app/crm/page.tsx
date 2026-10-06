"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Banner, Card, ErrorBox, Field, ScoreBadge, Shell, Stat, Tabs } from "../lib/ui";
import { useStored } from "../lib/store";
import { inr, LEADS_KEY, leadColumns, leadRow, PROFILES, STAGES, toLead, waLink, type Lead, type ProfileId, type Stage } from "../lib/leads";
import { aiAnalyzeLeads, auditLeads, syncToSheets } from "../lib/lead-actions";
import { csvToObjects, downloadCSV } from "../lib/csv";

const STAGE_COLOR: Record<Stage, string> = { New: "#64748b", Contacted: "#0ea5e9", Interested: "#8b5cf6", Meeting: "#f59e0b", "Proposal Sent": "#6366f1", Negotiation: "#ea580c", Won: "#16a34a", Lost: "#dc2626" };

export default function CRMPage() {
  const [leads, setLeads] = useStored<Lead[]>(LEADS_KEY, []);
  const [view, setView] = useState<"board" | "table" | "due">("board");
  const [q, setQ] = useState("");
  const [profile, setProfile] = useState<"" | ProfileId>("");
  const [temp, setTemp] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => leads.filter((l) =>
    (!q || `${l.name} ${l.category} ${l.address} ${l.notes}`.toLowerCase().includes(q.toLowerCase())) &&
    (!profile || l.profile === profile) && (!temp || l.temperature === temp),
  ), [leads, q, profile, temp]);
  const due = filtered.filter((l) => l.followUp && l.followUp <= today && !["Won", "Lost"].includes(l.stage)).sort((a, b) => a.followUp.localeCompare(b.followUp));

  const update = (id: string, patch: Partial<Lead>) => setLeads((all) => all.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const remove = (id: string) => { if (confirm("Delete this lead?")) setLeads((all) => all.filter((l) => l.id !== id)); };
  const logTouch = (l: Lead, channel: string, text: string) => update(l.id, {
    history: [...(l.history || []), { at: new Date().toISOString(), channel, text }],
    stage: l.stage === "New" ? "Contacted" : l.stage,
    followUp: l.followUp && l.followUp > today ? l.followUp : addDays(3),
  });
  const merge = (updated: Lead[]) => { const m = new Map(updated.map((u) => [u.id, u])); setLeads((all) => all.map((l) => m.get(l.id) ? { ...l, ...m.get(l.id), stage: l.stage, notes: l.notes, followUp: l.followUp, value: l.value, history: l.history } : l)); };

  async function bulk(kind: "audit" | "ai" | "sheets") {
    setError(""); setNotice("");
    try {
      if (kind === "audit") { merge(await auditLeads(filtered, (d, n) => setBusy(`Auditing ${d}/${n}…`))); setNotice("Websites audited and scores updated."); }
      if (kind === "ai") { merge(await aiAnalyzeLeads(filtered.slice(0, 60), (d, n) => setBusy(`AI analyzing ${d}/${n}…`))); setNotice("AI analysis added."); }
      if (kind === "sheets") { setBusy("Syncing…"); await syncToSheets(filtered); setNotice(`${filtered.length} leads sent to Google Sheets.`); }
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  function importCSV(file: File) {
    file.text().then((text) => {
      const rows = csvToObjects(text);
      const pick = (r: Record<string, string>, ...keys: string[]) => { for (const k of Object.keys(r)) if (keys.includes(k.toLowerCase().trim())) return r[k]; return ""; };
      const imported = rows.map((r, i) => toLead({
        id: `imp-${Date.now()}-${i}`, name: pick(r, "name", "business", "business name", "company") || `Lead ${i + 1}`,
        address: pick(r, "address", "location"), phone: pick(r, "phone", "mobile", "contact", "phone number"), website: pick(r, "website", "url", "site"),
        email: pick(r, "email", "e-mail"), rating: pick(r, "rating"), ratingValue: parseFloat(pick(r, "rating")) || undefined, reviews: parseInt(pick(r, "reviews", "review count")) || undefined,
        status: "", category: pick(r, "category", "type", "industry"), mapsLink: pick(r, "map link", "maps", "mapslink", "google maps"), source: "osm",
      }, profile || "designoia", "CSV import"));
      setLeads((all) => [...all, ...imported]);
      setNotice(`Imported ${imported.length} leads.`);
    });
  }

  const pipeline = leads.filter((l) => l.stage !== "Lost").reduce((s, l) => s + (l.value || 0), 0);
  const won = leads.filter((l) => l.stage === "Won").reduce((s, l) => s + (l.value || 0), 0);
  const edit = leads.find((l) => l.id === editing);

  return (
    <Shell icon="📇" title="Lead CRM & Follow-ups" wide desc={<>Every lead you save from <Link href="/gmaps">Lead Finder</Link> lands here. Move them through the pipeline, log calls/WhatsApps, set follow-ups and generate proposals. Data is stored in this browser — use CSV export or Sheets sync for backup/sharing.</>}>
      <div className="tk-grid" style={{ ["--min" as string]: "140px", marginBottom: 14 }}>
        <Stat value={leads.length} label="Total leads" />
        <Stat value={leads.filter((l) => l.temperature === "HOT").length} label="🔥 Hot" color="#dc2626" />
        <Stat value={due.length} label="⏰ Follow-ups due" color="#d97706" />
        <Stat value={leads.filter((l) => ["Proposal Sent", "Negotiation"].includes(l.stage)).length} label="📄 Proposals out" />
        <Stat value={inr(pipeline)} label="Pipeline value" color="#6366f1" />
        <Stat value={inr(won)} label="Won" color="#16a34a" />
      </div>

      <Card>
        <div className="tk-row">
          <input className="tk-input" style={{ maxWidth: 260 }} placeholder="Search name, area, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="tk-select" style={{ maxWidth: 220 }} value={profile} onChange={(e) => setProfile(e.target.value as ProfileId | "")}>
            <option value="">All businesses</option>
            {(Object.keys(PROFILES) as ProfileId[]).map((p) => <option key={p} value={p}>{PROFILES[p].icon} {PROFILES[p].label}</option>)}
          </select>
          <select className="tk-select" style={{ maxWidth: 140 }} value={temp} onChange={(e) => setTemp(e.target.value)}><option value="">All temps</option><option>HOT</option><option>WARM</option><option>COLD</option></select>
          <span style={{ flex: 1 }} />
          <button className="tk-btn sm" disabled={!!busy} onClick={() => bulk("audit")}>🩺 Audit</button>
          <button className="tk-btn sm" disabled={!!busy} onClick={() => bulk("ai")}>🤖 AI analyze</button>
          <button className="tk-btn sm" disabled={!!busy} onClick={() => bulk("sheets")}>📋 Sync Sheets</button>
          <button className="tk-btn sm" onClick={() => downloadCSV(filtered.map(leadRow), "crm-leads.csv", leadColumns())}>⬇ CSV</button>
          <label className="tk-btn sm">⬆ Import CSV<input type="file" accept=".csv" hidden onChange={(e) => e.target.files?.[0] && importCSV(e.target.files[0])} /></label>
          <Link className="tk-btn sm primary" href="/outreach?ch=whatsapp">💬 Outreach</Link>
        </div>
        {busy && <p className="tk-muted">⏳ {busy}</p>}
      </Card>
      <ErrorBox error={error} />
      {notice && <Banner tone="ok">{notice}</Banner>}

      <Tabs value={view} onChange={setView} items={[{ id: "board", label: "🗂 Pipeline" }, { id: "table", label: "📋 Table" }, { id: "due", label: `⏰ Follow-ups due (${due.length})` }]} />

      {!leads.length && <Banner tone="info">No leads yet. Find some in <Link href="/gmaps">Lead Finder</Link> and click “💾 Save to CRM”, or import a CSV.</Banner>}

      {view === "board" && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(210px, 1fr))`, gap: 10, overflowX: "auto", paddingBottom: 10 }}>
          {STAGES.map((st) => {
            const col = filtered.filter((l) => l.stage === st);
            return (
              <div key={st} style={{ background: "var(--hover)", borderRadius: 10, padding: 8, minHeight: 200 }}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("id"); if (id) update(id, { stage: st }); }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: STAGE_COLOR[st], marginBottom: 8 }}>{st} · {col.length} · {inr(col.reduce((s, l) => s + (l.value || 0), 0))}</div>
                {col.map((l) => (
                  <div key={l.id} draggable onDragStart={(e) => e.dataTransfer.setData("id", l.id)} onClick={() => setEditing(l.id)}
                    className="tk-card" style={{ padding: 10, marginBottom: 8, cursor: "grab" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{l.name}</div>
                    <div className="tk-muted" style={{ fontSize: 11 }}>{l.category}</div>
                    <div className="tk-row" style={{ marginTop: 6, gap: 4 }}>
                      <ScoreBadge score={l.leadScore} /><span className="tk-badge">{l.temperature}</span>
                      {!l.website && <span className="tk-badge red">no site</span>}
                      {l.followUp && <span className={`tk-badge ${l.followUp <= today ? "amber" : ""}`}>⏰ {l.followUp.slice(5)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {(view === "table" || view === "due") && (
        <div className="tk-table-wrap">
          <table className="tk-table">
            <thead><tr><th>Business</th><th>Contact</th><th>Score</th><th>Stage</th><th>Follow-up</th><th>Value ₹</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {(view === "due" ? due : filtered).map((l) => (
                <tr key={l.id}>
                  <td style={{ minWidth: 180 }}><b>{l.name}</b><div className="tk-muted">{l.category}</div>{l.website ? <a href={l.website} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>{l.website.replace(/^https?:\/\//, "").slice(0, 28)}</a> : <span className="tk-badge red">no website</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{l.phone && <><a href={`tel:${l.phone}`}>{l.phone}</a><br /></>}{l.email && <a href={`mailto:${l.email}`} style={{ fontSize: 11 }}>{l.email}</a>}</td>
                  <td><ScoreBadge score={l.leadScore} /> <span className="tk-badge">{l.temperature}</span></td>
                  <td><select className="tk-select" value={l.stage} onChange={(e) => update(l.id, { stage: e.target.value as Stage })}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></td>
                  <td><input className="tk-input" type="date" value={l.followUp} onChange={(e) => update(l.id, { followUp: e.target.value })} /></td>
                  <td><input className="tk-input" type="number" style={{ width: 100 }} value={l.value || ""} onChange={(e) => update(l.id, { value: +e.target.value })} /></td>
                  <td><textarea className="tk-textarea" style={{ minHeight: 36, minWidth: 160 }} value={l.notes} onChange={(e) => update(l.id, { notes: e.target.value })} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {l.phone && <a className="tk-btn sm" target="_blank" rel="noreferrer" href={waLink(l.phone, l.ai?.pitch || `Hi ${l.name}, `)} onClick={() => logTouch(l, "WhatsApp", "Opened WhatsApp chat")}>💬</a>}{" "}
                    <button className="tk-btn sm" onClick={() => setEditing(l.id)}>✏️</button>{" "}
                    <button className="tk-btn sm danger" onClick={() => remove(l.id)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <div onClick={() => setEditing(null)} style={{ position: "fixed", inset: 0, background: "#0008", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="tk-card" style={{ width: "min(720px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
            <div className="tk-row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ fontSize: 18, margin: 0 }}>{edit.name}</h3>
              <button className="tk-btn sm" onClick={() => setEditing(null)}>✕</button>
            </div>
            <p className="tk-muted">{edit.category} · {edit.address}</p>
            <div className="tk-grid" style={{ ["--min" as string]: "150px" }}>
              <Field label="Stage"><select className="tk-select" value={edit.stage} onChange={(e) => update(edit.id, { stage: e.target.value as Stage })}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Follow-up date"><input className="tk-input" type="date" value={edit.followUp} onChange={(e) => update(edit.id, { followUp: e.target.value })} /></Field>
              <Field label="Expected value (₹)"><input className="tk-input" type="number" value={edit.value || ""} onChange={(e) => update(edit.id, { value: +e.target.value })} /></Field>
              <Field label="Assigned to"><input className="tk-input" value={edit.assignedTo} onChange={(e) => update(edit.id, { assignedTo: e.target.value })} /></Field>
              <Field label="Phone"><input className="tk-input" value={edit.phone} onChange={(e) => update(edit.id, { phone: e.target.value })} /></Field>
              <Field label="Email"><input className="tk-input" value={edit.email || ""} onChange={(e) => update(edit.id, { email: e.target.value })} /></Field>
            </div>
            <div style={{ marginTop: 10 }}><Field label="Notes"><textarea className="tk-textarea" value={edit.notes} onChange={(e) => update(edit.id, { notes: e.target.value })} /></Field></div>
            <div className="tk-grid" style={{ marginTop: 10 }}>
              <div><b style={{ fontSize: 13 }}>Score {edit.leadScore} · {edit.temperature}</b><ul style={{ fontSize: 12, paddingLeft: 18 }}>{edit.reasons.map((r) => <li key={r}>{r}</li>)}</ul></div>
              <div><b style={{ fontSize: 13 }}>Opportunities</b><ul style={{ fontSize: 12, paddingLeft: 18 }}>{edit.opportunities.map((r) => <li key={r}>{r}</li>)}</ul></div>
            </div>
            {edit.ai && <Banner tone="info">🤖 {edit.ai.summary} {edit.ai.estimate && <b> · {edit.ai.estimate}</b>}</Banner>}
            <div className="tk-row">
              {edit.phone && <a className="tk-btn sm green" target="_blank" rel="noreferrer" href={waLink(edit.phone, edit.ai?.pitch || `Hi ${edit.name}, `)} onClick={() => logTouch(edit, "WhatsApp", "Opened WhatsApp chat")}>💬 WhatsApp</a>}
              {edit.phone && <a className="tk-btn sm" href={`tel:${edit.phone}`} onClick={() => logTouch(edit, "Call", "Called")}>📞 Call</a>}
              {edit.email && <a className="tk-btn sm" href={`mailto:${edit.email}`} onClick={() => logTouch(edit, "Email", "Opened email")}>📧 Email</a>}
              <Link className="tk-btn sm primary" href={`/proposal?lead=${encodeURIComponent(edit.id)}`}>📄 Proposal</Link>
              {edit.website && <Link className="tk-btn sm" href={`/seo-audit?url=${encodeURIComponent(edit.website)}`}>🩺 Audit</Link>}
              <button className="tk-btn sm danger" onClick={() => { remove(edit.id); setEditing(null); }}>Delete</button>
            </div>
            {!!edit.history?.length && <div style={{ marginTop: 12 }}><b style={{ fontSize: 13 }}>Activity</b>{edit.history.slice().reverse().map((h, i) => <div key={i} className="tk-muted">{h.at.slice(0, 16).replace("T", " ")} · {h.channel} · {h.text.slice(0, 120)}</div>)}</div>}
          </div>
        </div>
      )}
    </Shell>
  );
}

function addDays(n: number) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

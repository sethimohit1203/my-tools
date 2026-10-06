"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Banner, Card, ErrorBox, Field, Shell } from "../lib/ui";
import { csvToObjects, downloadCSV } from "../lib/csv";
import { processRows, PRESETS, type Row } from "../lib/bulk-ai";
import { useStored } from "../lib/store";
import { LEADS_KEY, leadRow, type Lead } from "../lib/leads";

export default function AIProcessorPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("data");
  const [instruction, setInstruction] = useState(PRESETS[0].instruction);
  const [outputs, setOutputs] = useState(PRESETS[0].outputs);
  const [limit, setLimit] = useState(500);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [leads] = useStored<Lead[]>(LEADS_KEY, []);
  const stop = useRef(false);

  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const outCols = outputs.split(",").map((s) => s.trim()).filter(Boolean);

  function load(file: File) {
    setFileName(file.name.replace(/\.[^.]+$/, ""));
    file.text().then((t) => { const r = csvToObjects(t); setRows(r); if (!r.length) setError("No rows found in that CSV."); else setError(""); });
  }

  async function run() {
    if (!rows.length || !outCols.length) return;
    stop.current = false; setError("");
    try {
      const target = rows.slice(0, limit);
      const done = await processRows(target, instruction, outCols, {
        onProgress: (d, n) => setProgress(`Processing rows ${d + 1}–${Math.min(d + 10, n)} of ${n}…`),
        shouldStop: () => stop.current,
        onBatch: (partial) => setRows([...partial, ...rows.slice(limit)]),
      });
      setRows([...done, ...rows.slice(limit)]);
      const errs = done.filter((r) => r._error).length;
      setProgress(stop.current ? "Stopped." : `✅ Done — ${target.length} rows processed${errs ? `, ${errs} failed (see _error column; re-run to retry)` : ""}.`);
    } catch (e) { setError((e as Error).message); setProgress(""); }
  }

  return (
    <Shell icon="🧠" title="AI Auto-Processor" desc="Upload a CSV (e.g. 500 businesses exported from Lead Finder, a student marks sheet, or a product list) → AI fills new columns for every row → download. Works in batches of 10 rows per AI call with automatic retries.">
      <Card title="1. Data">
        <div className="tk-row">
          <label className="tk-btn primary">📁 Upload CSV<input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
          <button className="tk-btn" disabled={!leads.length} onClick={() => { setRows(leads.map((l) => Object.fromEntries(Object.entries(leadRow(l)).map(([k, v]) => [k, String(v ?? "")])))); setFileName("crm-leads"); }}>📇 Use CRM leads ({leads.length})</button>
          {rows.length > 0 && <span className="tk-muted">{rows.length} rows · columns: {cols.slice(0, 8).join(", ")}{cols.length > 8 ? "…" : ""}</span>}
        </div>
        <p className="tk-muted">Tip: export Google Sheets via File → Download → CSV, or use the <Link href="/sheets-automation">Sheets Automation</Link> tool to read & write the sheet directly.</p>
      </Card>
      <Card title="2. What should AI do?">
        <div className="tk-row" style={{ marginBottom: 10 }}>{PRESETS.map((p) => <button key={p.name} className="tk-btn sm" onClick={() => { setInstruction(p.instruction); setOutputs(p.outputs); }}>{p.name}</button>)}</div>
        <Field label="Instruction"><textarea className="tk-textarea" value={instruction} onChange={(e) => setInstruction(e.target.value)} /></Field>
        <div className="tk-grid" style={{ marginTop: 10 }}>
          <Field label="New columns to fill (comma separated)"><input className="tk-input" value={outputs} onChange={(e) => setOutputs(e.target.value)} /></Field>
          <Field label="Max rows this run"><input className="tk-input" type="number" value={limit} onChange={(e) => setLimit(+e.target.value)} /></Field>
        </div>
        <div className="tk-row" style={{ marginTop: 12 }}>
          <button className="tk-btn green" disabled={!rows.length || (!!progress && !progress.startsWith("✅") && progress !== "Stopped.")} onClick={run}>▶ Process</button>
          <button className="tk-btn" onClick={() => { stop.current = true; }}>⏹ Stop</button>
          <button className="tk-btn" disabled={!rows.length} onClick={() => downloadCSV(rows, `${fileName}-ai.csv`)}>⬇ Download CSV</button>
          <span className="tk-muted">{progress}</span>
        </div>
      </Card>
      <ErrorBox error={error} />
      {rows.length > 0 && (
        <>
          <Banner tone="info">Showing the first 100 rows. New columns are highlighted.</Banner>
          <div className="tk-table-wrap" style={{ maxHeight: 520 }}>
            <table className="tk-table">
              <thead><tr>{cols.map((c) => <th key={c} style={outCols.includes(c) ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}>{c}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 100).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} style={{ maxWidth: 260 }}>{r[c]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}

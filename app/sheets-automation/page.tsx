"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Banner, Card, CopyButton, ErrorBox, Field, Shell, Tabs } from "../lib/ui";
import { api, useSettings } from "../lib/settings";
import { processRows, PRESETS, type Row } from "../lib/bulk-ai";
import { APPS_SCRIPT } from "../lib/apps-script";
import { downloadCSV } from "../lib/csv";
import { useStored } from "../lib/store";

export default function SheetsAutomationPage() {
  const [settings, setSettings] = useSettings();
  const [tab, setTab] = useState<"run" | "setup">("run");
  const [sheetUrl, setSheetUrl] = useStored("sheets-url", "");
  const [sheetName, setSheetName] = useStored("sheets-tab", "");
  const [rows, setRows] = useState<Row[]>([]);
  const [instruction, setInstruction] = useState(PRESETS[0].instruction);
  const [outputs, setOutputs] = useState(PRESETS[0].outputs);
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [writeMode, setWriteMode] = useState<"update" | "append">("update");
  const [matchCol, setMatchCol] = useState("");
  const [outTab, setOutTab] = useState("AI Results");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const stop = useRef(false);

  const outCols = outputs.split(",").map((s) => s.trim()).filter(Boolean);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];

  async function read() {
    setError(""); setProgress("Reading sheet…");
    try {
      const { rows: r } = await api<{ rows: Row[] }>("/api/sheets", { action: "read", sheetUrl, sheet: sheetName || undefined });
      setRows(r); setMatchCol(Object.keys(r[0] || {})[0] || "");
      setProgress(`Loaded ${r.length} rows.`);
    } catch (e) { setError((e as Error).message); setProgress(""); }
  }

  async function runAll() {
    if (!rows.length) return;
    stop.current = false; setError("");
    const todo = rows.map((r, i) => ({ r, i })).filter(({ r }) => !onlyEmpty || outCols.some((c) => !r[c]));
    if (!todo.length) { setProgress("Nothing to do — all rows already have the output columns filled."); return; }
    try {
      const done = await processRows(todo.map((t) => t.r), instruction, outCols, {
        onProgress: (d, n) => setProgress(`AI processing ${d + 1}–${Math.min(d + 10, n)} of ${n}…`),
        shouldStop: () => stop.current,
      });
      const merged = [...rows];
      todo.forEach((t, k) => { merged[t.i] = done[k]; });
      setRows(merged);
      if (!settings.sheetsWebhook) { setProgress("✅ AI done. Connect the Apps Script (Setup tab) to write back automatically — or download the CSV."); return; }
      setProgress("Writing results back to Google Sheets…");
      const changed = todo.map((t) => merged[t.i]);
      if (writeMode === "update") await api("/api/sheets", { webhookUrl: settings.sheetsWebhook, action: "update", sheet: sheetName || "Sheet1", matchColumn: matchCol, rows: changed });
      else await api("/api/sheets", { webhookUrl: settings.sheetsWebhook, action: "appendMany", sheet: outTab, rows: changed });
      setProgress(`✅ Done — ${changed.length} rows processed and written to ${writeMode === "update" ? `“${sheetName || "Sheet1"}”` : `“${outTab}”`}.`);
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <Shell icon="📋" title="Google Sheets Automation" desc="Sheet → AI processing → update rows. Read any sheet shared “Anyone with the link can view”, let AI fill columns row by row, and write the results back through a small Apps Script. Great for COL attendance/results, Designoia lead lists and ClikiXpress products.">
      <Tabs value={tab} onChange={setTab} items={[{ id: "run", label: "▶ Run" }, { id: "setup", label: `🔧 Setup ${settings.sheetsWebhook ? "✓" : "(write access)"}` }]} />
      {tab === "setup" && (
        <>
          <Card title="One-time setup to write to your sheets (2 minutes)">
            <ol style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18 }}>
              <li>Open your Google Sheet → <b>Extensions → Apps Script</b>.</li>
              <li>Delete the sample code, paste the script below, click 💾 Save.</li>
              <li><b>Deploy → New deployment</b> → type <b>Web app</b> → Execute as <b>Me</b>, Who has access <b>Anyone</b> → Deploy → authorise.</li>
              <li>Copy the <b>Web app URL</b> (ends with <code>/exec</code>) and paste it here:</li>
            </ol>
            <Field label="Apps Script web app URL"><input className="tk-input" value={settings.sheetsWebhook} placeholder="https://script.google.com/macros/s/…/exec" onChange={(e) => setSettings({ sheetsWebhook: e.target.value })} /></Field>
            <Banner tone="info">The same URL also lets Lead Finder / CRM “📋 Sheets” buttons and Workflow “Google Sheets” steps write rows. To trigger a workflow on every new row, see the <Link href="/automation?tab=webhooks">Webhooks tab</Link>.</Banner>
          </Card>
          <Card title="Apps Script code" actions={<CopyButton text={APPS_SCRIPT} label="Copy script" />}>
            <pre className="tk-pre tk-code" style={{ maxHeight: 400, overflow: "auto" }}>{APPS_SCRIPT}</pre>
          </Card>
        </>
      )}
      {tab === "run" && (
        <>
          <Card title="1. Read the sheet">
            <div className="tk-grid" style={{ ["--min" as string]: "220px" }}>
              <Field label="Google Sheet link" hint="Share → General access → Anyone with the link (Viewer)."><input className="tk-input" value={sheetUrl} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setSheetUrl(e.target.value)} /></Field>
              <Field label="Tab name (optional)"><input className="tk-input" value={sheetName} placeholder="Sheet1" onChange={(e) => setSheetName(e.target.value)} /></Field>
            </div>
            <button className="tk-btn primary" style={{ marginTop: 10 }} disabled={!sheetUrl} onClick={read}>📥 Read rows</button>
          </Card>
          <Card title="2. AI instruction">
            <div className="tk-row" style={{ marginBottom: 10 }}>{PRESETS.map((p) => <button key={p.name} className="tk-btn sm" onClick={() => { setInstruction(p.instruction); setOutputs(p.outputs); }}>{p.name}</button>)}</div>
            <Field label="Instruction"><textarea className="tk-textarea" value={instruction} onChange={(e) => setInstruction(e.target.value)} /></Field>
            <div className="tk-grid" style={{ marginTop: 10, ["--min" as string]: "200px" }}>
              <Field label="Output columns (comma separated)"><input className="tk-input" value={outputs} onChange={(e) => setOutputs(e.target.value)} /></Field>
              <Field label="Write results"><select className="tk-select" value={writeMode} onChange={(e) => setWriteMode(e.target.value as "update" | "append")}><option value="update">Update the same rows</option><option value="append">Append to another tab</option></select></Field>
              {writeMode === "update"
                ? <Field label="Match rows by column"><select className="tk-select" value={matchCol} onChange={(e) => setMatchCol(e.target.value)}>{cols.map((c) => <option key={c}>{c}</option>)}</select></Field>
                : <Field label="Output tab"><input className="tk-input" value={outTab} onChange={(e) => setOutTab(e.target.value)} /></Field>}
              <Field label="Rows"><label className="tk-row" style={{ fontSize: 13, paddingTop: 7 }}><input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} /> Only rows with empty outputs</label></Field>
            </div>
            <div className="tk-row" style={{ marginTop: 12 }}>
              <button className="tk-btn green" disabled={!rows.length} onClick={runAll}>▶ Process & write back</button>
              <button className="tk-btn" onClick={() => { stop.current = true; }}>⏹ Stop</button>
              <button className="tk-btn" disabled={!rows.length} onClick={() => downloadCSV(rows, "sheet-ai.csv")}>⬇ CSV</button>
              <span className="tk-muted">{progress}</span>
            </div>
            {!settings.sheetsWebhook && <Banner tone="warn">Write-back isn&apos;t set up yet — results stay here (download CSV) until you finish the Setup tab.</Banner>}
          </Card>
          <ErrorBox error={error} />
          {rows.length > 0 && (
            <div className="tk-table-wrap" style={{ maxHeight: 500 }}>
              <table className="tk-table">
                <thead><tr>{cols.map((c) => <th key={c} style={outCols.includes(c) ? { color: "var(--accent)" } : undefined}>{c}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 200).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} style={{ maxWidth: 240 }}>{r[c]}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

"use client";
import { useMemo, useState } from "react";
import { Banner, Card, CopyButton, ErrorBox, Field, Shell, Stat, Tabs } from "../lib/ui";
import { aiJSON, api } from "../lib/settings";
import { downloadCSV } from "../lib/csv";
import { useStored } from "../lib/store";

type KW = { keyword: string; source: string; rank: number; words: number; intent: string; type: string; question: boolean; priority: number; cluster: string };
type AiCluster = { name: string; intent: string; pillar: string; keywords: string[]; contentIdea: string };

const INTENT_TONE: Record<string, string> = { Transactional: "green", Commercial: "accent", Local: "amber", Informational: "", Navigational: "" };

export default function KeywordPage() {
  const [seed, setSeed] = useState("");
  const [country, setCountry] = useState("in");
  const [data, setData] = useStored<{ seed: string; keywords: KW[]; clusters: Record<string, string[]> } | null>("kw-last", null);
  const [aiClusters, setAiClusters] = useState<AiCluster[]>([]);
  const [tab, setTab] = useState<"all" | "clusters" | "questions">("all");
  const [intent, setIntent] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function run() {
    if (!seed.trim()) return;
    setBusy("Collecting Google autocomplete suggestions (≈40 queries)…"); setError(""); setAiClusters([]);
    try {
      const d = await api<{ keywords: KW[]; clusters: Record<string, string[]> }>("/api/keywords", { seed, country });
      setData({ seed, ...d });
      if (!d.keywords.length) setError("No suggestions returned — try a broader seed keyword.");
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  async function aiCluster() {
    if (!data) return;
    setBusy("AI is clustering keywords into topics…");
    try {
      const r = await aiJSON<{ clusters: AiCluster[] }>(`Group these keywords for "${data.seed}" into 5-12 SEO topic clusters. For each: {"name","intent":"Informational|Commercial|Transactional|Local","pillar":"suggested pillar page title","keywords":[...],"contentIdea":"one blog/landing page idea"}. Return {"clusters":[...]}.\nKeywords:\n${data.keywords.slice(0, 250).map((k) => k.keyword).join("\n")}`, { maxTokens: 5000 });
      setAiClusters(r.clusters || []);
      setTab("clusters");
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  const list = useMemo(() => (data?.keywords || []).filter((k) => !intent || k.intent === intent).filter((k) => tab !== "questions" || k.question).sort((a, b) => b.priority - a.priority), [data, intent, tab]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; (data?.keywords || []).forEach((k) => (c[k.intent] = (c[k.intent] || 0) + 1)); return c; }, [data]);

  return (
    <Shell icon="🔑" title="Keyword Researcher" desc="Free keyword ideas from Google Autocomplete — what people actually type — expanded with a–z and question modifiers, then tagged by search intent and grouped into clusters. Priority is a popularity estimate from autocomplete position (no search-volume API needed).">
      <Card>
        <div className="tk-grid" style={{ ["--min" as string]: "200px" }}>
          <Field label="Seed keyword"><input className="tk-input" value={seed} placeholder="e.g. website design delhi" onChange={(e) => setSeed(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} /></Field>
          <Field label="Country"><select className="tk-select" value={country} onChange={(e) => setCountry(e.target.value)}>{[["in", "India"], ["us", "USA"], ["gb", "UK"], ["ae", "UAE"], ["ca", "Canada"], ["au", "Australia"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>
        <div className="tk-row" style={{ marginTop: 12 }}>
          <button className="tk-btn primary" disabled={!!busy} onClick={run}>Find keywords</button>
          {data && <button className="tk-btn" disabled={!!busy} onClick={aiCluster}>🤖 AI topic clusters</button>}
          {data && <button className="tk-btn" onClick={() => downloadCSV(list as unknown as Record<string, unknown>[], `keywords-${data.seed.replace(/\s+/g, "-")}.csv`, ["keyword", "intent", "type", "priority", "cluster", "question"])}>⬇ CSV</button>}
          {data && <CopyButton text={list.map((k) => k.keyword).join("\n")} label="Copy list" />}
          {busy && <span className="tk-muted">⏳ {busy}</span>}
        </div>
      </Card>
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="tk-grid" style={{ ["--min" as string]: "130px", marginBottom: 12 }}>
            <Stat value={data.keywords.length} label="Keywords" />
            {Object.entries(counts).map(([k, v]) => <Stat key={k} value={v} label={k} />)}
            <Stat value={data.keywords.filter((k) => k.question).length} label="Questions" />
          </div>
          <Tabs value={tab} onChange={setTab} items={[{ id: "all", label: "All keywords" }, { id: "questions", label: "❓ Questions (FAQ ideas)" }, { id: "clusters", label: "🧩 Clusters" }]} />
          {tab !== "clusters" ? (
            <Card actions={<select className="tk-select" value={intent} onChange={(e) => setIntent(e.target.value)}><option value="">All intents</option>{Object.keys(counts).map((k) => <option key={k}>{k}</option>)}</select>}>
              <div className="tk-table-wrap" style={{ maxHeight: 600 }}>
                <table className="tk-table">
                  <thead><tr><th>Keyword</th><th>Intent</th><th>Type</th><th>Priority</th><th>Cluster</th></tr></thead>
                  <tbody>{list.map((k) => (
                    <tr key={k.keyword}><td><a href={`https://www.google.com/search?q=${encodeURIComponent(k.keyword)}`} target="_blank" rel="noreferrer">{k.keyword}</a></td><td><span className={`tk-badge ${INTENT_TONE[k.intent] || ""}`}>{k.intent}</span></td><td>{k.type}</td><td>{k.priority}</td><td>{k.cluster}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          ) : aiClusters.length ? (
            <div className="tk-grid" style={{ ["--min" as string]: "300px" }}>
              {aiClusters.map((c) => (
                <Card key={c.name} title={`${c.name} · ${c.keywords.length}`}>
                  <div className="tk-row" style={{ marginBottom: 6 }}><span className="tk-badge accent">{c.intent}</span></div>
                  <p style={{ fontSize: 13, margin: "0 0 6px" }}><b>Pillar:</b> {c.pillar}</p>
                  <p className="tk-muted" style={{ margin: "0 0 8px" }}>💡 {c.contentIdea}</p>
                  <div style={{ fontSize: 12 }}>{c.keywords.join(" · ")}</div>
                </Card>
              ))}
            </div>
          ) : (
            <>
              <Banner tone="info">Quick clusters by shared modifier word. Click “🤖 AI topic clusters” for smarter semantic grouping with pillar pages.</Banner>
              <div className="tk-grid" style={{ ["--min" as string]: "260px" }}>
                {Object.entries(data.clusters).sort((a, b) => b[1].length - a[1].length).slice(0, 40).map(([name, kws]) => (
                  <Card key={name} title={`${name} · ${kws.length}`}><div style={{ fontSize: 12 }}>{kws.join(" · ")}</div></Card>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Shell>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";
import { Card, CopyButton, ErrorBox, Field, Shell } from "../lib/ui";
import { aiJSON } from "../lib/settings";
import { useStored } from "../lib/store";
import { downloadCSV } from "../lib/csv";

type Item = { date: string; channel: string; format: string; title: string; keyword: string; brief: string; cta: string; status?: string };

export default function ContentPlannerPage() {
  const [biz, setBiz] = useState({ business: "", audience: "", goals: "", month: new Date().toISOString().slice(0, 7), channels: "Blog, Instagram, Facebook, LinkedIn, YouTube Shorts", perWeek: "4", keywords: "" });
  const [plan, setPlan] = useStored<Item[]>("content-plan", []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!biz.business.trim()) { setError("Describe the business first."); return; }
    setBusy(true); setError("");
    try {
      const r = await aiJSON<{ items: Item[] }>(`Create a content calendar for ${biz.month} (dates in YYYY-MM-DD within that month).
Business: ${biz.business}
Audience: ${biz.audience || "local customers in India"}
Goals: ${biz.goals || "leads and brand awareness"}
Channels: ${biz.channels}
Posts per week (all channels): ${biz.perWeek}
Target keywords: ${biz.keywords || "choose relevant ones"}
Mix educational, promotional, social-proof, festival/seasonal (Indian festivals in that month) and behind-the-scenes content.
Return {"items":[{"date","channel","format":"blog|reel|carousel|post|short|story","title","keyword","brief":"2-3 sentence outline","cta"}]}.`, { maxTokens: 6000 });
      setPlan((r.items || []).map((i) => ({ ...i, status: "Planned" })).sort((a, b) => a.date.localeCompare(b.date)));
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  const upd = (i: number, p: Partial<Item>) => setPlan(plan.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <Shell icon="🗓️" title="Content Planner" desc={<>AI builds a monthly content calendar for blogs and social channels. Then push posts to <Link href="/social">Social Automation</Link> or write blogs with the <Link href="/blog-gen">Blog Generator</Link>.</>}>
      <Card>
        <div className="tk-grid" style={{ ["--min" as string]: "240px" }}>
          <Field label="Business"><input className="tk-input" value={biz.business} placeholder="Circle of Learning — after-school coding & science workshops, Delhi" onChange={(e) => setBiz({ ...biz, business: e.target.value })} /></Field>
          <Field label="Audience"><input className="tk-input" value={biz.audience} placeholder="Parents of 8–16 year olds, school principals" onChange={(e) => setBiz({ ...biz, audience: e.target.value })} /></Field>
          <Field label="Goals"><input className="tk-input" value={biz.goals} placeholder="Workshop sign-ups, school partnerships" onChange={(e) => setBiz({ ...biz, goals: e.target.value })} /></Field>
          <Field label="Month"><input className="tk-input" type="month" value={biz.month} onChange={(e) => setBiz({ ...biz, month: e.target.value })} /></Field>
          <Field label="Channels"><input className="tk-input" value={biz.channels} onChange={(e) => setBiz({ ...biz, channels: e.target.value })} /></Field>
          <Field label="Posts per week"><input className="tk-input" type="number" value={biz.perWeek} onChange={(e) => setBiz({ ...biz, perWeek: e.target.value })} /></Field>
        </div>
        <div style={{ marginTop: 10 }}><Field label="Target keywords (optional)"><input className="tk-input" value={biz.keywords} placeholder="coding classes for kids delhi, robotics workshop" onChange={(e) => setBiz({ ...biz, keywords: e.target.value })} /></Field></div>
        <div className="tk-row" style={{ marginTop: 12 }}>
          <button className="tk-btn primary" disabled={busy} onClick={generate}>{busy ? "⏳ Planning…" : "🤖 Generate plan"}</button>
          {plan.length > 0 && <><button className="tk-btn" onClick={() => downloadCSV(plan as unknown as Record<string, unknown>[], `content-plan-${biz.month}.csv`)}>⬇ CSV</button>
            <CopyButton text={plan.map((p) => `${p.date}\t${p.channel}\t${p.format}\t${p.title}`).join("\n")} label="Copy for Sheets" />
            <Link className="tk-btn" href="/social">📱 Send to Social Automation</Link></>}
        </div>
      </Card>
      <ErrorBox error={error} />
      {plan.length > 0 && (
        <div className="tk-table-wrap">
          <table className="tk-table">
            <thead><tr><th>Date</th><th>Channel</th><th>Format</th><th>Title & brief</th><th>Keyword</th><th>CTA</th><th>Status</th><th></th></tr></thead>
            <tbody>{plan.map((p, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: "nowrap" }}>{p.date}</td><td>{p.channel}</td><td><span className="tk-badge">{p.format}</span></td>
                <td style={{ minWidth: 260 }}><b>{p.title}</b><div className="tk-muted">{p.brief}</div></td>
                <td>{p.keyword}</td><td>{p.cta}</td>
                <td><select className="tk-select" value={p.status} onChange={(e) => upd(i, { status: e.target.value })}>{["Planned", "Writing", "Ready", "Published"].map((s) => <option key={s}>{s}</option>)}</select></td>
                <td>{/blog/i.test(p.format + p.channel) && <Link className="tk-btn sm" href={`/blog-gen?topic=${encodeURIComponent(p.title)}&kw=${encodeURIComponent(p.keyword)}`}>✍️ Write</Link>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

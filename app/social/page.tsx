"use client";
import Link from "next/link";
import { useState } from "react";
import { Banner, Card, CopyButton, ErrorBox, Field, Shell, Stat } from "../lib/ui";
import { readStored, useStored, uid } from "../lib/store";
import { aiJSON, api, useSettings } from "../lib/settings";
import { downloadCSV } from "../lib/csv";

type Post = { id: string; date: string; time: string; platforms: string[]; topic: string; caption: string; hashtags: string; imageUrl: string; status: "Draft" | "Ready" | "Published" | "Failed"; result?: string };
const PLATFORMS = ["Instagram", "Facebook", "LinkedIn", "X", "Google Business"];

export default function SocialPage() {
  const [settings, setSettings] = useSettings();
  const [posts, setPosts] = useStored<Post[]>("social-posts", []);
  const [brand, setBrand] = useStored("social-brand", "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const todayS = new Date().toISOString().slice(0, 10);

  const upd = (id: string, p: Partial<Post>) => setPosts((x) => x.map((y) => (y.id === id ? { ...y, ...p } : y)));
  const add = () => setPosts((x) => [...x, { id: uid(), date: todayS, time: "10:00", platforms: ["Instagram", "Facebook"], topic: "", caption: "", hashtags: "", imageUrl: "", status: "Draft" }]);

  function importPlan() {
    const plan = readStored<{ date: string; channel: string; format: string; title: string; brief: string; cta: string }[]>("content-plan", []);
    const social = plan.filter((p) => !/blog/i.test(p.channel + p.format));
    if (!social.length) { setNotice("No social posts in the Content Planner yet."); return; }
    setPosts((x) => [...x, ...social.map((p) => ({ id: uid(), date: p.date, time: "10:00", platforms: PLATFORMS.filter((pl) => p.channel.toLowerCase().includes(pl.toLowerCase().split(" ")[0])).length ? PLATFORMS.filter((pl) => p.channel.toLowerCase().includes(pl.toLowerCase().split(" ")[0])) : ["Instagram"], topic: `${p.title} — ${p.brief} (CTA: ${p.cta})`, caption: "", hashtags: "", imageUrl: "", status: "Draft" as const }))]);
    setNotice(`Imported ${social.length} posts from the Content Planner.`);
  }

  async function aiCaptions() {
    const todo = posts.filter((p) => !p.caption && p.topic);
    if (!todo.length) { setNotice("Add topics first (or all posts already have captions)."); return; }
    setError("");
    try {
      for (let i = 0; i < todo.length; i += 8) {
        setBusy(`Writing captions ${i + 1}–${Math.min(i + 8, todo.length)} of ${todo.length}…`);
        const b = todo.slice(i, i + 8);
        const r = await aiJSON<{ posts: { id: string; caption: string; hashtags: string }[] }>(`Brand: ${brand || settings.agencyName}. Write social media captions for an Indian audience. For each post: an engaging caption (hook in the first line, 2-4 short lines, emoji ok, end with the call-to-action) adapted to its platforms, and 8-12 relevant hashtags as one space-separated string. Return {"posts":[{"id","caption","hashtags"}]}.\n${JSON.stringify(b.map((p) => ({ id: p.id, platforms: p.platforms, topic: p.topic })))}`);
        setPosts((all) => all.map((p) => { const m = r.posts?.find((x) => x.id === p.id); return m ? { ...p, caption: m.caption, hashtags: m.hashtags, status: "Ready" } : p; }));
      }
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  async function publish(list: Post[]) {
    if (!settings.socialWebhook) { setError("Add a publishing webhook below (n8n / Make / Zapier → Buffer / Meta) first, or export the CSV."); return; }
    setError("");
    for (const [n, p] of list.entries()) {
      setBusy(`Publishing ${n + 1}/${list.length}…`);
      try {
        const r = await api<{ status: number; ok: boolean; data: unknown }>("/api/http", { url: settings.socialWebhook, method: "POST", body: { platforms: p.platforms, text: `${p.caption}\n\n${p.hashtags}`.trim(), caption: p.caption, hashtags: p.hashtags, imageUrl: p.imageUrl, scheduledAt: `${p.date}T${p.time}:00+05:30`, topic: p.topic, id: p.id } });
        upd(p.id, r.ok ? { status: "Published", result: `Sent ✓ (${r.status})` } : { status: "Failed", result: `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 120)}` });
      } catch (e) { upd(p.id, { status: "Failed", result: (e as Error).message }); }
    }
    setBusy("");
  }

  const due = posts.filter((p) => p.status === "Ready" && p.date <= todayS);

  return (
    <Shell icon="📱" title="Social Media Automation" wide desc={<>Content calendar → AI captions & hashtags → publish → track status. Plan posts in the <Link href="/content-planner">Content Planner</Link>, generate captions here, then publish through your own webhook (n8n, Make or Zapier connected to Buffer / Meta / LinkedIn) or export a CSV for bulk scheduling.</>}>
      <div className="tk-grid" style={{ ["--min" as string]: "130px", marginBottom: 14 }}>
        <Stat value={posts.length} label="Posts" /><Stat value={posts.filter((p) => p.status === "Draft").length} label="Draft" />
        <Stat value={posts.filter((p) => p.status === "Ready").length} label="Ready" color="#6366f1" /><Stat value={due.length} label="Due now" color="#d97706" />
        <Stat value={posts.filter((p) => p.status === "Published").length} label="Published" color="#16a34a" /><Stat value={posts.filter((p) => p.status === "Failed").length} label="Failed" color="#dc2626" />
      </div>
      <Card>
        <div className="tk-grid" style={{ ["--min" as string]: "240px" }}>
          <Field label="Brand / voice"><input className="tk-input" value={brand} placeholder="Designoia — friendly, expert web agency in Delhi" onChange={(e) => setBrand(e.target.value)} /></Field>
          <Field label="Publishing webhook" hint="Receives JSON {platforms, text, caption, hashtags, imageUrl, scheduledAt}."><input className="tk-input" value={settings.socialWebhook} placeholder="https://your-n8n/webhook/social" onChange={(e) => setSettings({ socialWebhook: e.target.value })} /></Field>
        </div>
        <div className="tk-row" style={{ marginTop: 12 }}>
          <button className="tk-btn" onClick={add}>+ Add post</button>
          <button className="tk-btn" onClick={importPlan}>🗓 Import from Content Planner</button>
          <button className="tk-btn primary" disabled={!!busy} onClick={aiCaptions}>🤖 AI captions</button>
          <button className="tk-btn green" disabled={!!busy || !due.length} onClick={() => publish(due)}>🚀 Publish due ({due.length})</button>
          <button className="tk-btn" disabled={!posts.length} onClick={() => downloadCSV(posts.map((p) => ({ Date: p.date, Time: p.time, Platforms: p.platforms.join(", "), Text: `${p.caption}\n\n${p.hashtags}`, "Image URL": p.imageUrl, Status: p.status })), "social-calendar.csv")}>⬇ CSV (Buffer/Meta bulk)</button>
          {busy && <span className="tk-muted">⏳ {busy}</span>}
        </div>
      </Card>
      <ErrorBox error={error} />
      {notice && <Banner tone="ok">{notice}</Banner>}
      {!posts.length && <Banner tone="info">No posts yet — add one, or import your Content Planner calendar.</Banner>}
      {posts.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((p) => (
        <Card key={p.id}>
          <div className="tk-row" style={{ marginBottom: 8 }}>
            <input className="tk-input" type="date" style={{ maxWidth: 160 }} value={p.date} onChange={(e) => upd(p.id, { date: e.target.value })} />
            <input className="tk-input" type="time" style={{ maxWidth: 120 }} value={p.time} onChange={(e) => upd(p.id, { time: e.target.value })} />
            {PLATFORMS.map((pl) => <label key={pl} className="tk-row" style={{ fontSize: 12, gap: 4 }}><input type="checkbox" checked={p.platforms.includes(pl)} onChange={(e) => upd(p.id, { platforms: e.target.checked ? [...p.platforms, pl] : p.platforms.filter((x) => x !== pl) })} />{pl}</label>)}
            <span style={{ flex: 1 }} />
            <select className="tk-select" style={{ maxWidth: 130 }} value={p.status} onChange={(e) => upd(p.id, { status: e.target.value as Post["status"] })}>{["Draft", "Ready", "Published", "Failed"].map((s) => <option key={s}>{s}</option>)}</select>
            <button className="tk-btn sm" disabled={!!busy} onClick={() => publish([p])}>🚀</button>
            <CopyButton text={`${p.caption}\n\n${p.hashtags}`} />
            <button className="tk-btn sm danger" onClick={() => setPosts((x) => x.filter((y) => y.id !== p.id))}>✕</button>
          </div>
          <div className="tk-grid" style={{ ["--min" as string]: "260px" }}>
            <Field label="Topic / brief"><textarea className="tk-textarea" style={{ minHeight: 70 }} value={p.topic} onChange={(e) => upd(p.id, { topic: e.target.value })} /></Field>
            <Field label="Caption"><textarea className="tk-textarea" style={{ minHeight: 70 }} value={p.caption} onChange={(e) => upd(p.id, { caption: e.target.value })} /></Field>
            <Field label="Hashtags"><textarea className="tk-textarea" style={{ minHeight: 70 }} value={p.hashtags} onChange={(e) => upd(p.id, { hashtags: e.target.value })} /></Field>
            <Field label="Image URL"><input className="tk-input" value={p.imageUrl} onChange={(e) => upd(p.id, { imageUrl: e.target.value })} />{p.result && <div className="tk-muted" style={{ marginTop: 4 }}>{p.result}</div>}</Field>
          </div>
        </Card>
      ))}
    </Shell>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { Banner, Card, CopyButton, ErrorBox, Field, Shell, Stat, Tabs } from "../lib/ui";
import { useStored, uid } from "../lib/store";
import { aiJSON, api, hasAI, useSettings } from "../lib/settings";
import { download, downloadCSV } from "../lib/csv";
import {
  ART_STYLES, DEFAULT_SERIES, SHORTS_SYSTEM, SUBGENRES, fullPrompt, ideasPrompt, scriptPrompt, toSRT, totalSeconds,
  voiceoverText, webhookPayload, type Idea, type Scene, type Series, type Short,
} from "../lib/shorts";

type Tab = "ideas" | "library" | "studio";
type RawScript = Partial<Short> & { scenes?: Partial<Scene>[] };

function buildShort(raw: RawScript, idea: Idea): Short {
  return {
    id: uid(), idea: idea.title,
    title: raw.title || idea.title, hook: raw.hook || idea.hook,
    styleBible: raw.styleBible || "", musicMood: raw.musicMood || "",
    scenes: (raw.scenes || []).map((s, i) => ({
      n: i + 1, narration: s.narration || "", caption: s.caption || "", imagePrompt: s.imagePrompt || "",
      motion: s.motion || "slow zoom in", sfx: s.sfx || "", seconds: Number(s.seconds) || 5, imageUrl: "",
    })),
    description: raw.description || "", hashtags: raw.hashtags || "", thumbnailText: raw.thumbnailText || "",
    status: "Draft", createdAt: new Date().toISOString(),
  };
}

export default function ShortsPage() {
  const [settings, setSettings] = useSettings();
  const [series, setSeries] = useStored<Series>("shorts-series", DEFAULT_SERIES);
  const [ideas, setIdeas] = useStored<Idea[]>("shorts-ideas", []);
  const [library, setLibrary] = useStored<Short[]>("shorts-library", []);
  const [tab, setTab] = useState<Tab>("ideas");
  const [openId, setOpenId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const open = library.find((s) => s.id === openId);
  const setS = (patch: Partial<Series>) => setSeries({ ...series, ...patch });
  const updShort = (id: string, patch: Partial<Short>) => setLibrary((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const updScene = (id: string, n: number, patch: Partial<Scene>) =>
    setLibrary((l) => l.map((s) => (s.id === id ? { ...s, scenes: s.scenes.map((sc) => (sc.n === n ? { ...sc, ...patch } : sc)) } : s)));

  async function genIdeas() {
    if (!hasAI(settings)) { setError("Pehle ⚙ Settings me AI key daalo (Groq/Gemini free hai)."); return; }
    setError(""); setNotice(""); setBusy("Viral horror ideas bana raha hu…");
    try {
      const r = await aiJSON<{ ideas: Omit<Idea, "id">[] }>(ideasPrompt(series, 10, ideas.map((i) => i.title)), { system: SHORTS_SYSTEM });
      const fresh = (r.ideas || []).map((i) => ({ ...i, id: uid() }));
      setIdeas((x) => [...fresh, ...x]);
      setNotice(`${fresh.length} naye ideas add hue.`);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  async function makeShorts(list: Idea[]) {
    if (!hasAI(settings)) { setError("Pehle ⚙ Settings me AI key daalo."); return; }
    setError(""); setNotice("");
    let first = "";
    for (const [i, idea] of list.entries()) {
      setBusy(`Script ${i + 1}/${list.length}: ${idea.title}`);
      try {
        const raw = await aiJSON<RawScript>(scriptPrompt(series, idea), { system: SHORTS_SYSTEM, maxTokens: 6000 });
        const short = buildShort(raw, idea);
        if (!short.scenes.length) throw new Error("AI ne scenes nahi diye, dobara try karo.");
        if (!first) first = short.id;
        setLibrary((l) => [short, ...l]);
      } catch (e) { setError(`"${idea.title}": ${(e as Error).message}`); }
    }
    setBusy(""); setPicked([]);
    if (first) { setOpenId(first); setTab("studio"); }
  }

  async function sendToRenderer(s: Short) {
    if (!settings.shortsWebhook) { setError("⚙ Settings me Shorts render webhook daalo (n8n / Make), ya JSON export karo."); return; }
    setError(""); setBusy("Webhook ko bhej raha hu…");
    try {
      const r = await api<{ status: number; ok: boolean; data: unknown }>("/api/http", { url: settings.shortsWebhook, method: "POST", body: webhookPayload(s) });
      updShort(s.id, r.ok ? { status: "Sent", result: `Sent ✓ (${r.status})` } : { status: "Failed", result: `HTTP ${r.status}` });
    } catch (e) { updShort(s.id, { status: "Failed", result: (e as Error).message }); }
    setBusy("");
  }

  const stats = { ideas: ideas.length, shorts: library.length, ready: library.filter((s) => s.status === "Ready").length, sent: library.filter((s) => s.status === "Sent").length };

  return (
    <Shell icon="👻" title="Horror Shorts Studio" desc="Hindi/Hinglish horror-suspense animated Shorts: viral idea → script → scene prompts → voice-over, captions → render webhook. Faceless, 9:16.">
      <div className="tk-grid" style={{ ["--min" as string]: "130px", marginBottom: 14 }}>
        <Stat value={stats.ideas} label="Ideas" /><Stat value={stats.shorts} label="Scripts" />
        <Stat value={stats.ready} label="Ready" color="#16a34a" /><Stat value={stats.sent} label="Sent to renderer" color="#6366f1" />
      </div>

      <Card title="🎬 Channel setup">
        <div className="tk-grid" style={{ ["--min" as string]: "240px" }}>
          <Field label="Channel name"><input className="tk-input" value={series.channel} placeholder="e.g. Raat Ka Raaz" onChange={(e) => setS({ channel: e.target.value })} /></Field>
          <Field label="Horror sub-genre"><select className="tk-select" value={series.subgenre} onChange={(e) => setS({ subgenre: e.target.value })}>{SUBGENRES.map((g) => <option key={g}>{g}</option>)}</select></Field>
          <Field label="Animation style"><select className="tk-select" value={series.art} onChange={(e) => setS({ art: e.target.value })}>{ART_STYLES.map((g) => <option key={g}>{g}</option>)}</select></Field>
          <Field label="Length (sec)"><select className="tk-select" value={series.seconds} onChange={(e) => setS({ seconds: Number(e.target.value) })}>{[30, 45, 55].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <Field label="Narrator voice"><input className="tk-input" value={series.voice} onChange={(e) => setS({ voice: e.target.value })} /></Field>
          <Field label="Render webhook (n8n / Make)" hint="Receives voiceover, SRT captions, scene prompts, hashtags as JSON."><input className="tk-input" value={settings.shortsWebhook} placeholder="https://your-n8n/webhook/shorts" onChange={(e) => setSettings({ shortsWebhook: e.target.value })} /></Field>
        </div>
      </Card>

      <Tabs value={tab} onChange={setTab} items={[{ id: "ideas", label: `💡 Viral ideas (${ideas.length})` }, { id: "library", label: `📚 Scripts (${library.length})` }, { id: "studio", label: "🎞️ Studio" }]} />
      <ErrorBox error={error} />
      {notice && <Banner tone="ok">{notice}</Banner>}
      {busy && <Banner tone="info">⏳ {busy}</Banner>}

      {tab === "ideas" && (
        <Card title="Viral idea generator" actions={<>
          <button className="tk-btn primary" disabled={!!busy} onClick={genIdeas}>✨ 10 naye ideas</button>
          <button className="tk-btn green" disabled={!!busy || !picked.length} onClick={() => makeShorts(ideas.filter((i) => picked.includes(i.id)))}>🎬 Selected ({picked.length}) ke scripts</button>
          <button className="tk-btn danger" disabled={!ideas.length} onClick={() => { setIdeas([]); setPicked([]); }}>Clear</button>
        </>}>
          {!ideas.length && <p className="tk-muted">Ideas generate karo, jo pasand aaye usse select karke script banao. Batch me bhi chal sakta hai.</p>}
          {ideas.map((i) => (
            <div key={i.id} className="tk-row" style={{ alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
              <input type="checkbox" checked={picked.includes(i.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i.id] : p.filter((x) => x !== i.id)))} />
              <div style={{ flex: 1 }}>
                <b>{i.title}</b>
                <div className="tk-muted" style={{ fontSize: 12 }}>🎣 {i.hook}</div>
                <div style={{ fontSize: 12 }}>{i.angle}</div>
                <div className="tk-muted" style={{ fontSize: 11 }}>🔥 {i.whyViral}</div>
              </div>
              <button className="tk-btn sm" disabled={!!busy} onClick={() => makeShorts([i])}>Script</button>
            </div>
          ))}
        </Card>
      )}

      {tab === "library" && (
        <Card title="Generated scripts" actions={<button className="tk-btn" disabled={!library.length} onClick={() => downloadCSV(library.map((s) => ({ title: s.title, status: s.status, seconds: totalSeconds(s), hashtags: s.hashtags, voiceover: voiceoverText(s) })), "shorts.csv")}>⬇ CSV</button>}>
          {!library.length && <p className="tk-muted">Abhi koi script nahi. Ideas tab se banao.</p>}
          {library.map((s) => (
            <div key={s.id} className="tk-row" style={{ justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
              <div><b>{s.title}</b> <span className="tk-badge">{s.status}</span><div className="tk-muted" style={{ fontSize: 12 }}>{s.scenes.length} scenes · {totalSeconds(s)}s {s.result ? `· ${s.result}` : ""}</div></div>
              <div className="tk-row">
                <button className="tk-btn sm" onClick={() => { setOpenId(s.id); setTab("studio"); }}>Open</button>
                <button className="tk-btn sm danger" onClick={() => setLibrary((l) => l.filter((x) => x.id !== s.id))}>✕</button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {tab === "studio" && (open ? (
        <Studio short={open} busy={!!busy} onShort={(p) => updShort(open.id, p)} onScene={(n, p) => updScene(open.id, n, p)} onSend={() => sendToRenderer(open)} />
      ) : <Card><p className="tk-muted">Library me se ek script open karo.</p></Card>)}
    </Shell>
  );
}

function Studio({ short, busy, onShort, onScene, onSend }: { short: Short; busy: boolean; onShort: (p: Partial<Short>) => void; onScene: (n: number, p: Partial<Scene>) => void; onSend: () => void }) {
  const allPrompts = short.scenes.map((s) => `Scene ${s.n}: ${fullPrompt(short, s)}`).join("\n\n");
  return (
    <>
      <Card title={short.title} actions={<>
        <button className="tk-btn" onClick={() => onShort({ status: short.status === "Ready" ? "Draft" : "Ready" })}>{short.status === "Ready" ? "↩ Draft" : "✓ Mark ready"}</button>
        <button className="tk-btn primary" disabled={busy} onClick={onSend}>🚀 Render webhook</button>
      </>}>
        <div className="tk-grid" style={{ ["--min" as string]: "300px", alignItems: "start" }}>
          <Player short={short} />
          <div style={{ display: "grid", gap: 10 }}>
            <Field label="Title"><input className="tk-input" value={short.title} onChange={(e) => onShort({ title: e.target.value })} /></Field>
            <Field label="Style bible (har scene me use hota hai)"><textarea className="tk-textarea" value={short.styleBible} onChange={(e) => onShort({ styleBible: e.target.value })} /></Field>
            <Field label="Description"><textarea className="tk-textarea" value={short.description} onChange={(e) => onShort({ description: e.target.value })} /></Field>
            <Field label="Hashtags"><input className="tk-input" value={short.hashtags} onChange={(e) => onShort({ hashtags: e.target.value })} /></Field>
            <div className="tk-muted" style={{ fontSize: 12 }}>🎵 {short.musicMood} · 🖼 Thumbnail: <b>{short.thumbnailText}</b> · ⏱ {totalSeconds(short)}s</div>
            <div className="tk-row" style={{ flexWrap: "wrap" }}>
              <CopyButton text={voiceoverText(short)} label="Voice-over" />
              <CopyButton text={allPrompts} label="All image prompts" />
              <button className="tk-btn sm" onClick={() => download(toSRT(short), `${short.id}.srt`, "text/plain")}>⬇ SRT</button>
              <button className="tk-btn sm" onClick={() => download(JSON.stringify(webhookPayload(short), null, 2), `${short.id}.json`, "application/json")}>⬇ JSON</button>
            </div>
            {short.result && <span className="tk-muted">{short.result}</span>}
          </div>
        </div>
      </Card>

      <Card title="Scenes">
        {short.scenes.map((s) => (
          <div key={s.n} style={{ padding: "10px 0", borderTop: "1px solid var(--border)", display: "grid", gap: 6 }}>
            <div className="tk-row" style={{ justifyContent: "space-between" }}><b>Scene {s.n}</b><span className="tk-muted" style={{ fontSize: 12 }}>{s.motion} · 🔊 {s.sfx} · {s.seconds}s</span></div>
            <div className="tk-grid" style={{ ["--min" as string]: "260px" }}>
              <Field label="Narration (Hinglish)"><textarea className="tk-textarea" style={{ minHeight: 60 }} value={s.narration} onChange={(e) => onScene(s.n, { narration: e.target.value })} /></Field>
              <Field label="Image / video prompt"><textarea className="tk-textarea" style={{ minHeight: 60 }} value={s.imagePrompt} onChange={(e) => onScene(s.n, { imagePrompt: e.target.value })} /></Field>
              <Field label="On-screen caption"><input className="tk-input" value={s.caption} onChange={(e) => onScene(s.n, { caption: e.target.value })} /></Field>
              <Field label="Generated image/clip URL (preview ke liye)"><input className="tk-input" value={s.imageUrl} placeholder="https://…" onChange={(e) => onScene(s.n, { imageUrl: e.target.value })} /></Field>
            </div>
            <div><CopyButton text={fullPrompt(short, s)} label="Full prompt" /></div>
          </div>
        ))}
      </Card>
    </>
  );
}

/** 9:16 preview: Ken-Burns scenes, big captions and optional Hindi TTS voice-over. */
function Player({ short }: { short: Short }) {
  const [idx, setIdx] = useState(-1);
  const [speak, setSpeak] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => { if (timer.current) clearTimeout(timer.current); window.speechSynthesis?.cancel(); setIdx(-1); };
  useEffect(() => stop, []); // stop on unmount
  useEffect(() => () => stop(), [short.id]);

  function play(i: number) {
    if (i >= short.scenes.length) { stop(); return; }
    const sc = short.scenes[i];
    setIdx(i);
    if (speak && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(sc.narration);
      u.lang = "hi-IN"; u.rate = 0.92; u.pitch = 0.8;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    }
    timer.current = setTimeout(() => play(i + 1), Math.max(1.5, sc.seconds) * 1000);
  }

  const sc = idx >= 0 ? short.scenes[idx] : null;
  return (
    <div>
      <div style={{ position: "relative", width: "100%", maxWidth: 270, aspectRatio: "9 / 16", margin: "0 auto", borderRadius: 14, overflow: "hidden", background: "radial-gradient(circle at 50% 30%, #1e293b, #020617)" }}>
        {sc?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={sc.n} src={sc.imageUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", animation: `shortsZoom ${sc.seconds}s linear forwards` }} />
        )}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16, background: "linear-gradient(transparent 55%, rgba(0,0,0,.75))" }}>
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 22, textAlign: "center", textShadow: "0 2px 8px #000", textTransform: "uppercase" }}>{sc ? sc.caption : "▶ Preview"}</span>
        </div>
      </div>
      <style>{"@keyframes shortsZoom{from{transform:scale(1)}to{transform:scale(1.15)}}"}</style>
      <div className="tk-row" style={{ justifyContent: "center", marginTop: 8 }}>
        <button className="tk-btn sm" onClick={() => (idx >= 0 ? stop() : play(0))}>{idx >= 0 ? "■ Stop" : "▶ Play"}</button>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Hindi voice</label>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { Banner, Card, ErrorBox, Field, Shell } from "../lib/ui";
import { aiJSON, api, useSettings } from "../lib/settings";
import { download, slugify } from "../lib/csv";

type Img = { id: string; file: File; srcUrl: string; outUrl?: string; outBlob?: Blob; outSize?: number; w?: number; h?: number; filename: string; alt: string; title: string; status?: string };

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

async function convert(img: Img, fmt: string, quality: number, maxW: number) {
  const el = await load(img.srcUrl);
  const scale = maxW && el.naturalWidth > maxW ? maxW / el.naturalWidth : 1;
  const w = Math.round(el.naturalWidth * scale), h = Math.round(el.naturalHeight * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  if (fmt === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(el, 0, 0, w, h);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), fmt, quality / 100));
  return { blob, w, h };
}

const toDataUrl = (b: Blob) => new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(b); });
const kb = (n?: number) => (n == null ? "—" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);

export default function ImageSEOPage() {
  const [settings] = useSettings();
  const [imgs, setImgs] = useState<Img[]>([]);
  const [fmt, setFmt] = useState("image/webp");
  const [quality, setQuality] = useState(80);
  const [maxW, setMaxW] = useState(1600);
  const [keyword, setKeyword] = useState("");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const ext = fmt === "image/webp" ? "webp" : fmt === "image/jpeg" ? "jpg" : "png";

  function add(files: FileList | null) {
    if (!files) return;
    const list = [...files].filter((f) => f.type.startsWith("image/")).map((file, i) => ({
      id: Math.random().toString(36).slice(2), file, srcUrl: URL.createObjectURL(file),
      filename: slugify(keyword ? `${keyword} ${imgs.length + i + 1}` : file.name.replace(/\.[^.]+$/, "")),
      alt: "", title: "",
    }));
    setImgs((x) => [...x, ...list]);
  }
  const upd = (id: string, p: Partial<Img>) => setImgs((x) => x.map((i) => (i.id === id ? { ...i, ...p } : i)));

  async function processAll() {
    setBusy("Optimizing…"); setError("");
    const out: Img[] = [];
    for (const i of imgs) {
      try { const { blob, w, h } = await convert(i, fmt, quality, maxW); out.push({ ...i, outBlob: blob, outUrl: URL.createObjectURL(blob), outSize: blob.size, w, h }); }
      catch { out.push({ ...i, status: "❌ could not read" }); }
    }
    setImgs(out); setBusy("");
  }

  function applyKeyword() {
    setImgs((x) => x.map((i, n) => ({ ...i, filename: slugify(`${keyword} ${n + 1}`), alt: i.alt || `${keyword}${context ? ` — ${context}` : ""}`, title: i.title || keyword })));
  }

  async function aiText() {
    setBusy("AI writing filenames, alt and title text…"); setError("");
    try {
      const r = await aiJSON<{ images: { id: string; filename: string; alt: string; title: string }[] }>(`Write SEO image metadata. Page/context: ${context || "not given"}. Focus keyword: ${keyword || "not given"}.
For each image (identified by its original filename), return {"images":[{"id","filename":"lowercase-hyphenated, 3-6 words, no extension","alt":"descriptive alt text under 125 chars, natural keyword use","title":"short title"}]}. Vary the wording; don't stuff keywords.
Images: ${JSON.stringify(imgs.map((i) => ({ id: i.id, original: i.file.name })))}`);
      for (const m of r.images || []) upd(m.id, { filename: slugify(m.filename), alt: m.alt, title: m.title });
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  async function downloadAll() {
    for (const i of imgs) {
      if (!i.outBlob) continue;
      download(i.outBlob, `${i.filename}.${ext}`);
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  async function toWordPress() {
    setBusy("Uploading to WordPress media library…"); setError("");
    for (const i of imgs) {
      if (!i.outBlob) continue;
      try {
        const { data } = await api<{ data: { id: number; url: string } }>("/api/wp", { wpUrl: settings.wpUrl, wpUser: settings.wpUser, wpPass: settings.wpPass, action: "uploadData", dataUrl: await toDataUrl(i.outBlob), filename: `${i.filename}.${ext}`, alt: i.alt, title: i.title });
        upd(i.id, { status: `✅ WP media #${data.id}` });
      } catch (e) { upd(i.id, { status: "❌ " + (e as Error).message }); }
    }
    setBusy("");
  }

  const before = imgs.reduce((s, i) => s + i.file.size, 0), after = imgs.reduce((s, i) => s + (i.outSize || 0), 0);

  return (
    <Shell icon="🖼️" title="Image SEO Tool" desc="Convert to WebP, compress and resize in your browser (nothing is uploaded unless you send to WordPress), then give every image an SEO filename, alt text and title — manually, from a keyword, or with AI.">
      <Card>
        <label className="tk-btn primary" style={{ width: "100%", justifyContent: "center", padding: 22, borderStyle: "dashed" }}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}>
          📁 Drop images here or click to choose
          <input type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
        </label>
        <div className="tk-grid" style={{ ["--min" as string]: "160px", marginTop: 12 }}>
          <Field label="Output format"><select className="tk-select" value={fmt} onChange={(e) => setFmt(e.target.value)}><option value="image/webp">WebP (recommended)</option><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option></select></Field>
          <Field label={`Quality: ${quality}`}><input type="range" min={40} max={100} value={quality} onChange={(e) => setQuality(+e.target.value)} style={{ width: "100%" }} /></Field>
          <Field label="Max width"><select className="tk-select" value={maxW} onChange={(e) => setMaxW(+e.target.value)}>{[0, 800, 1200, 1600, 1920, 2560].map((w) => <option key={w} value={w}>{w || "Keep original"}</option>)}</select></Field>
          <Field label="Focus keyword"><input className="tk-input" value={keyword} placeholder="luxury car rental delhi" onChange={(e) => setKeyword(e.target.value)} /></Field>
          <Field label="Page context"><input className="tk-input" value={context} placeholder="ProRido fleet page" onChange={(e) => setContext(e.target.value)} /></Field>
        </div>
        <div className="tk-row" style={{ marginTop: 12 }}>
          <button className="tk-btn primary" disabled={!imgs.length || !!busy} onClick={processAll}>⚡ Optimize all</button>
          <button className="tk-btn" disabled={!imgs.length || !keyword} onClick={applyKeyword}>🏷 Apply keyword names</button>
          <button className="tk-btn" disabled={!imgs.length || !!busy} onClick={aiText}>🤖 AI alt/title/filenames</button>
          <button className="tk-btn" disabled={!after} onClick={downloadAll}>⬇ Download all</button>
          <button className="tk-btn" disabled={!after || !!busy} onClick={toWordPress}>🌐 Upload to WordPress</button>
          <button className="tk-btn danger" disabled={!imgs.length} onClick={() => setImgs([])}>Clear</button>
          {busy && <span className="tk-muted">⏳ {busy}</span>}
        </div>
      </Card>
      <ErrorBox error={error} />
      {after > 0 && <Banner tone="ok">Total: {kb(before)} → {kb(after)} ({Math.round((1 - after / before) * 100)}% smaller)</Banner>}
      <div className="tk-grid" style={{ ["--min" as string]: "300px" }}>
        {imgs.map((i) => (
          <Card key={i.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.outUrl || i.srcUrl} alt={i.alt} style={{ width: "100%", height: 170, objectFit: "cover", borderRadius: 8, background: "var(--hover)" }} />
            <div className="tk-muted" style={{ margin: "6px 0" }}>{i.file.name} · {kb(i.file.size)} {i.outSize != null && <>→ <b>{kb(i.outSize)}</b> · {i.w}×{i.h}</>} {i.status}</div>
            <Field label="Filename"><div className="tk-row" style={{ flexWrap: "nowrap" }}><input className="tk-input" value={i.filename} onChange={(e) => upd(i.id, { filename: slugify(e.target.value) })} /><span className="tk-muted">.{ext}</span></div></Field>
            <Field label={`Alt text (${i.alt.length}/125)`}><input className="tk-input" value={i.alt} onChange={(e) => upd(i.id, { alt: e.target.value })} /></Field>
            <Field label="Title"><input className="tk-input" value={i.title} onChange={(e) => upd(i.id, { title: e.target.value })} /></Field>
            <div className="tk-row" style={{ marginTop: 8 }}>
              {i.outBlob && <button className="tk-btn sm" onClick={() => download(i.outBlob!, `${i.filename}.${ext}`)}>⬇ Download</button>}
              <button className="tk-btn sm danger" onClick={() => setImgs((x) => x.filter((y) => y.id !== i.id))}>Remove</button>
            </div>
          </Card>
        ))}
      </div>
    </Shell>
  );
}

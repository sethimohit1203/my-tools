"use client";
import { useEffect, useRef, useState } from "react";
import { Banner, Card, CopyButton, ErrorBox, Field, Shell } from "../lib/ui";
import { aiJSON, api, useSettings } from "../lib/settings";
import { useQueryParam, useStored } from "../lib/store";
import { download, slugify } from "../lib/csv";

type Blog = { title: string; slug: string; metaTitle: string; metaDescription: string; focusKeyword: string; excerpt: string; html: string; faq: { q: string; a: string }[]; tags: string[] };

export default function BlogGenPage() {
  const [settings] = useSettings();
  const qTopic = useQueryParam("topic"), qKw = useQueryParam("kw");
  const [f, setF] = useState({ topic: "", keyword: "", audience: "", tone: "Friendly, expert", words: "1200", business: "" });
  const [blog, setBlog] = useStored<Blog | null>("blog-last", null);
  const [status, setStatus] = useState<"draft" | "publish" | "future">("draft");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pre = useRef(false);

  useEffect(() => {
    if (!pre.current && (qTopic || qKw)) { pre.current = true; setF((x) => ({ ...x, topic: qTopic, keyword: qKw })); }
  }, [qTopic, qKw]);

  async function generate() {
    if (!f.topic.trim()) { setError("Enter a topic."); return; }
    setBusy("Writing the article (30–60s)…"); setError(""); setNotice("");
    try {
      const b = await aiJSON<Blog>(`Write a complete, original, SEO-optimised blog post.
Topic: ${f.topic}
Focus keyword: ${f.keyword || "derive from topic"}
Audience: ${f.audience || "Indian readers"}
Business/brand to mention naturally (optional): ${f.business || "none"}
Tone: ${f.tone}. Length: about ${f.words} words.
Structure: engaging intro with the keyword in the first 100 words, H2/H3 sections, a bullet list, a short table if useful, a conclusion with a call-to-action, and an FAQ (4-5 questions).
Return JSON {"title","slug","metaTitle"(<=60 chars),"metaDescription"(<=155 chars),"focusKeyword","excerpt","html"(article body as clean HTML using <h2>,<h3>,<p>,<ul>,<li>,<table>,<strong> — no <h1>, no FAQ),"faq":[{"q","a"}],"tags":[...]}.`, { maxTokens: 8000 });
      b.slug = slugify(b.slug || b.title);
      setBlog(b);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  const faqHtml = blog?.faq?.length ? `<h2>Frequently Asked Questions</h2>${blog.faq.map((x) => `<h3>${x.q}</h3><p>${x.a}</p>`).join("")}` : "";
  const schema = blog?.faq?.length ? JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: blog.faq.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) }) : "";
  const fullHtml = blog ? `${blog.html}${faqHtml}${schema ? `\n<script type="application/ld+json">${schema}</script>` : ""}` : "";

  async function publish() {
    if (!blog) return;
    setBusy("Publishing to WordPress…"); setError("");
    try {
      const payload: Record<string, unknown> = {
        title: blog.title, slug: blog.slug, content: fullHtml, excerpt: blog.excerpt, status,
        meta: { rank_math_title: blog.metaTitle, rank_math_description: blog.metaDescription, rank_math_focus_keyword: blog.focusKeyword },
      };
      if (status === "future" && date) payload.date = date;
      const { data } = await api<{ data: { id: number; link: string } }>("/api/wp", { wpUrl: settings.wpUrl, wpUser: settings.wpUser, wpPass: settings.wpPass, method: "POST", endpoint: "/wp-json/wp/v2/posts", payload });
      setNotice(`✅ Post #${data.id} created as ${status}: ${data.link}`);
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  return (
    <Shell icon="✍️" title="Blog Generator" desc="Generate a full SEO blog post — meta title/description, headings, FAQ and FAQ schema — and publish it to WordPress (draft, live or scheduled). Rank Math fields are filled when the plugin exposes them to the REST API.">
      <Card>
        <div className="tk-grid" style={{ ["--min" as string]: "240px" }}>
          <Field label="Topic / title idea *"><input className="tk-input" value={f.topic} placeholder="How much does a website cost in India in 2026?" onChange={(e) => setF({ ...f, topic: e.target.value })} /></Field>
          <Field label="Focus keyword"><input className="tk-input" value={f.keyword} placeholder="website cost in india" onChange={(e) => setF({ ...f, keyword: e.target.value })} /></Field>
          <Field label="Audience"><input className="tk-input" value={f.audience} placeholder="Small business owners" onChange={(e) => setF({ ...f, audience: e.target.value })} /></Field>
          <Field label="Brand to mention"><input className="tk-input" value={f.business} placeholder="Designoia" onChange={(e) => setF({ ...f, business: e.target.value })} /></Field>
          <Field label="Tone"><input className="tk-input" value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} /></Field>
          <Field label="Length (words)"><select className="tk-select" value={f.words} onChange={(e) => setF({ ...f, words: e.target.value })}>{["800", "1200", "1800", "2500"].map((w) => <option key={w}>{w}</option>)}</select></Field>
        </div>
        <button className="tk-btn primary" style={{ marginTop: 12 }} disabled={!!busy} onClick={generate}>{busy && !blog ? `⏳ ${busy}` : "🤖 Generate article"}</button>
      </Card>
      <ErrorBox error={error} />
      {notice && <Banner tone="ok">{notice}</Banner>}
      {blog && (
        <>
          <Card title="SEO fields">
            <div className="tk-grid" style={{ ["--min" as string]: "260px" }}>
              <Field label={`Title (${blog.title.length})`}><input className="tk-input" value={blog.title} onChange={(e) => setBlog({ ...blog, title: e.target.value })} /></Field>
              <Field label="Slug"><input className="tk-input" value={blog.slug} onChange={(e) => setBlog({ ...blog, slug: slugify(e.target.value) })} /></Field>
              <Field label={`Meta title (${blog.metaTitle.length}/60)`}><input className="tk-input" value={blog.metaTitle} onChange={(e) => setBlog({ ...blog, metaTitle: e.target.value })} /></Field>
              <Field label={`Meta description (${blog.metaDescription.length}/155)`}><input className="tk-input" value={blog.metaDescription} onChange={(e) => setBlog({ ...blog, metaDescription: e.target.value })} /></Field>
            </div>
          </Card>
          <Card title="Publish to WordPress" actions={<><CopyButton text={fullHtml} label="Copy HTML" /><button className="tk-btn sm" onClick={() => download(`<h1>${blog.title}</h1>\n${fullHtml}`, `${blog.slug}.html`, "text/html")}>⬇ HTML</button></>}>
            {!settings.wpUrl && <Banner tone="warn">Connect your WordPress site in ⚙ Settings to publish directly.</Banner>}
            <div className="tk-row">
              <select className="tk-select" style={{ maxWidth: 160 }} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="draft">Draft</option><option value="publish">Publish now</option><option value="future">Schedule</option></select>
              {status === "future" && <input className="tk-input" style={{ maxWidth: 230 }} type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />}
              <button className="tk-btn primary" disabled={!!busy} onClick={publish}>🌐 Send to {settings.wpUrl ? settings.wpUrl.replace(/^https?:\/\//, "") : "WordPress"}</button>
              {busy && <span className="tk-muted">⏳ {busy}</span>}
            </div>
          </Card>
          <Card title="Preview">
            <article style={{ fontSize: 15, lineHeight: 1.75 }}>
              <h1 style={{ fontSize: 28 }}>{blog.title}</h1>
              <div dangerouslySetInnerHTML={{ __html: (blog.html + faqHtml).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+=("[^"]*"|'[^']*')/gi, "") }} />
            </article>
          </Card>
        </>
      )}
    </Shell>
  );
}

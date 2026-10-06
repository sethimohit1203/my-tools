"use client";
import Link from "next/link";
import { useState } from "react";
import { Banner, Card, ErrorBox, Shell, Tabs } from "../lib/ui";
import { aiJSON, api, useSettings } from "../lib/settings";
import { csvToObjects, downloadCSV } from "../lib/csv";

type WPPost = { id: number; title: { rendered: string }; link: string; status: string; date: string; excerpt?: { rendered: string }; meta?: Record<string, unknown>; featured_media?: number };
type Job = { title: string; content: string; status: string; date: string; slug: string; metaTitle: string; metaDescription: string; focusKeyword: string; imageUrl: string; imageAlt: string; categories: string; result?: string };

const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&#8217;/g, "'").replace(/&amp;/g, "&").trim();

export default function WPAutomationPage() {
  const [settings] = useSettings();
  const [tab, setTab] = useState<"bulk" | "meta" | "schema">("bulk");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [posts, setPosts] = useState<(WPPost & { newTitle?: string; newDesc?: string; kw?: string; result?: string; schema?: string })[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const creds = { wpUrl: settings.wpUrl, wpUser: settings.wpUser, wpPass: settings.wpPass };
  const wp = <T,>(method: string, endpoint: string, payload?: unknown, query?: Record<string, string>) => api<{ data: T }>("/api/wp", { ...creds, method, endpoint, payload, query }).then((r) => r.data);

  function loadCSV(file: File) {
    file.text().then((t) => {
      const rows = csvToObjects(t);
      const g = (r: Record<string, string>, k: string) => r[Object.keys(r).find((x) => x.toLowerCase().replace(/[^a-z]/g, "") === k.toLowerCase()) || ""] || "";
      setJobs(rows.map((r) => ({ title: g(r, "title"), content: g(r, "content"), status: g(r, "status") || "draft", date: g(r, "date"), slug: g(r, "slug"), metaTitle: g(r, "metatitle"), metaDescription: g(r, "metadescription"), focusKeyword: g(r, "focuskeyword"), imageUrl: g(r, "imageurl"), imageAlt: g(r, "imagealt"), categories: g(r, "categories") })));
    });
  }

  async function aiFillContent() {
    const todo = jobs.map((j, i) => ({ j, i })).filter(({ j }) => j.title && !j.content);
    setError("");
    for (const [n, { j, i }] of todo.entries()) {
      setBusy(`AI writing ${n + 1}/${todo.length}: ${j.title}`);
      try {
        const r = await aiJSON<{ html: string; metaTitle: string; metaDescription: string; focusKeyword: string }>(`Write an SEO blog post titled "${j.title}"${j.focusKeyword ? ` targeting "${j.focusKeyword}"` : ""}, ~900 words, HTML with h2/h3/p/ul (no h1). Return {"html","metaTitle","metaDescription","focusKeyword"}.`, { maxTokens: 5000 });
        setJobs((all) => all.map((x, k) => k === i ? { ...x, content: r.html, metaTitle: x.metaTitle || r.metaTitle, metaDescription: x.metaDescription || r.metaDescription, focusKeyword: x.focusKeyword || r.focusKeyword } : x));
      } catch (e) { setError((e as Error).message); break; }
    }
    setBusy("");
  }

  async function runJobs() {
    setError("");
    const catCache = new Map<string, number>();
    for (const [i, j] of jobs.entries()) {
      if (j.result?.startsWith("✅")) continue;
      setBusy(`Publishing ${i + 1}/${jobs.length}: ${j.title}`);
      try {
        let featured: number | undefined;
        if (j.imageUrl) featured = (await api<{ data: { id: number } }>("/api/wp", { ...creds, action: "upload", imageUrl: j.imageUrl, alt: j.imageAlt || j.title })).data.id;
        const cats: number[] = [];
        for (const c of j.categories.split(/[,;|]/).map((x) => x.trim()).filter(Boolean)) {
          if (!catCache.has(c)) {
            const found = await wp<{ id: number; name: string }[]>("GET", "/wp-json/wp/v2/categories", undefined, { search: c, per_page: "5" });
            const hit = found.find((f) => f.name.toLowerCase() === c.toLowerCase());
            catCache.set(c, hit ? hit.id : (await wp<{ id: number }>("POST", "/wp-json/wp/v2/categories", { name: c })).id);
          }
          cats.push(catCache.get(c)!);
        }
        const payload: Record<string, unknown> = { title: j.title, content: j.content, status: j.date && j.status === "publish" && new Date(j.date) > new Date() ? "future" : j.status || "draft" };
        if (j.date) payload.date = j.date;
        if (j.slug) payload.slug = j.slug;
        if (featured) payload.featured_media = featured;
        if (cats.length) payload.categories = cats;
        if (j.metaTitle || j.metaDescription || j.focusKeyword) payload.meta = { rank_math_title: j.metaTitle, rank_math_description: j.metaDescription, rank_math_focus_keyword: j.focusKeyword };
        const r = await wp<{ id: number; link: string; status: string }>("POST", "/wp-json/wp/v2/posts", payload);
        setJobs((all) => all.map((x, k) => (k === i ? { ...x, result: `✅ #${r.id} ${r.status} — ${r.link}` } : x)));
      } catch (e) {
        setJobs((all) => all.map((x, k) => (k === i ? { ...x, result: "❌ " + (e as Error).message } : x)));
      }
    }
    setBusy("");
  }

  async function loadPosts() {
    setBusy("Loading posts…"); setError("");
    try {
      const list = await wp<WPPost[]>("GET", "/wp-json/wp/v2/posts", undefined, { per_page: "50", status: "publish,draft,future", context: "edit", _fields: "id,title,link,status,date,excerpt,meta,featured_media" });
      setPosts(list.map((p) => ({ ...p, newTitle: String(p.meta?.rank_math_title || ""), newDesc: String(p.meta?.rank_math_description || ""), kw: String(p.meta?.rank_math_focus_keyword || "") })));
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  async function aiMeta() {
    setError("");
    try {
      for (let i = 0; i < posts.length; i += 10) {
        setBusy(`AI writing meta ${i + 1}–${Math.min(i + 10, posts.length)}…`);
        const b = posts.slice(i, i + 10);
        const r = await aiJSON<{ items: { id: number; metaTitle: string; metaDescription: string; focusKeyword: string }[] }>(`Write SEO meta for each WordPress post: metaTitle ≤60 chars, metaDescription 120-155 chars with a CTA, focusKeyword. Return {"items":[{"id","metaTitle","metaDescription","focusKeyword"}]}.\n${JSON.stringify(b.map((p) => ({ id: p.id, title: strip(p.title.rendered), excerpt: strip(p.excerpt?.rendered || "").slice(0, 300) })))}`);
        setPosts((all) => all.map((p) => { const m = r.items?.find((x) => x.id === p.id); return m ? { ...p, newTitle: m.metaTitle, newDesc: m.metaDescription, kw: m.focusKeyword } : p; }));
      }
    } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  async function saveMeta() {
    for (const [n, p] of posts.entries()) {
      setBusy(`Updating ${n + 1}/${posts.length}…`);
      try {
        await wp("POST", `/wp-json/wp/v2/posts/${p.id}`, { meta: { rank_math_title: p.newTitle, rank_math_description: p.newDesc, rank_math_focus_keyword: p.kw } });
        setPosts((all) => all.map((x) => (x.id === p.id ? { ...x, result: "✅ saved" } : x)));
      } catch (e) { setPosts((all) => all.map((x) => (x.id === p.id ? { ...x, result: "❌ " + (e as Error).message } : x))); }
    }
    setBusy(""); setNotice("Done. If values don't stick, Rank Math's meta fields aren't exposed to the REST API — enable them with a small register_post_meta snippet (show_in_rest).");
  }

  async function addSchema() {
    for (const [n, p] of posts.entries()) {
      setBusy(`Adding Article schema ${n + 1}/${posts.length}…`);
      try {
        const full = await wp<{ content: { raw: string } }>("GET", `/wp-json/wp/v2/posts/${p.id}`, undefined, { context: "edit", _fields: "content" });
        if (full.content.raw.includes("application/ld+json")) { setPosts((a) => a.map((x) => x.id === p.id ? { ...x, result: "already has schema" } : x)); continue; }
        const schema = { "@context": "https://schema.org", "@type": "Article", headline: strip(p.title.rendered), datePublished: p.date, mainEntityOfPage: p.link, author: { "@type": "Organization", name: settings.agencyName }, publisher: { "@type": "Organization", name: settings.agencyName } };
        await wp("POST", `/wp-json/wp/v2/posts/${p.id}`, { content: `${full.content.raw}\n<!-- wp:html --><script type="application/ld+json">${JSON.stringify(schema)}</script><!-- /wp:html -->` });
        setPosts((a) => a.map((x) => x.id === p.id ? { ...x, result: "✅ schema added" } : x));
      } catch (e) { setPosts((a) => a.map((x) => x.id === p.id ? { ...x, result: "❌ " + (e as Error).message } : x)); }
    }
    setBusy("");
  }

  return (
    <Shell icon="🌐" title="WordPress Automation" wide desc={<>Bulk-create/schedule posts with featured images and categories, rewrite SEO meta for many posts with AI, and add Article schema. Uses the site in ⚙ Settings{settings.wpUrl ? ` (${settings.wpUrl})` : ""}. For one-off natural-language edits use the <Link href="/wp-api">WordPress AI Tool</Link>.</>}>
      {!settings.wpUrl && <Banner tone="warn">Connect a WordPress site (URL, username, Application Password) in ⚙ Settings first.</Banner>}
      <Tabs value={tab} onChange={setTab} items={[{ id: "bulk", label: "📝 Bulk create & schedule" }, { id: "meta", label: "🏷 Bulk SEO meta" }, { id: "schema", label: "🧩 Schema" }]} />
      <ErrorBox error={error} />
      {notice && <Banner tone="ok">{notice}</Banner>}
      {busy && <Banner tone="info">⏳ {busy}</Banner>}

      {tab === "bulk" && (
        <>
          <Card title="Posts to create">
            <p className="tk-muted">Upload a CSV with columns: <code>title, content, status (draft/publish), date (2026-11-01T09:00:00 to schedule), slug, metaTitle, metaDescription, focusKeyword, imageUrl, imageAlt, categories</code>. Leave content empty and click “AI write content”.</p>
            <div className="tk-row">
              <label className="tk-btn primary">📁 Upload CSV<input type="file" accept=".csv" hidden onChange={(e) => e.target.files?.[0] && loadCSV(e.target.files[0])} /></label>
              <button className="tk-btn" onClick={() => downloadCSV([{ title: "10 Website Mistakes Small Businesses Make", content: "", status: "publish", date: "2026-11-01T09:00:00", slug: "", metaTitle: "", metaDescription: "", focusKeyword: "website mistakes", imageUrl: "", imageAlt: "", categories: "Web Design" }], "wp-bulk-template.csv")}>⬇ Template</button>
              <button className="tk-btn" onClick={() => setJobs([...jobs, { title: "", content: "", status: "draft", date: "", slug: "", metaTitle: "", metaDescription: "", focusKeyword: "", imageUrl: "", imageAlt: "", categories: "" }])}>+ Row</button>
              <button className="tk-btn" disabled={!!busy || !jobs.length} onClick={aiFillContent}>🤖 AI write content</button>
              <button className="tk-btn green" disabled={!!busy || !jobs.length} onClick={runJobs}>🚀 Create {jobs.length} posts</button>
            </div>
          </Card>
          {jobs.length > 0 && (
            <div className="tk-table-wrap"><table className="tk-table">
              <thead><tr><th>Title</th><th>Status / date</th><th>Focus kw</th><th>Image URL</th><th>Categories</th><th>Content</th><th>Result</th><th></th></tr></thead>
              <tbody>{jobs.map((j, i) => {
                const u = (p: Partial<Job>) => setJobs(jobs.map((x, k) => (k === i ? { ...x, ...p } : x)));
                return (
                  <tr key={i}>
                    <td><input className="tk-input" value={j.title} onChange={(e) => u({ title: e.target.value })} /></td>
                    <td><select className="tk-select" value={j.status} onChange={(e) => u({ status: e.target.value })}><option>draft</option><option>publish</option></select><input className="tk-input" placeholder="2026-11-01T09:00" value={j.date} onChange={(e) => u({ date: e.target.value })} /></td>
                    <td><input className="tk-input" value={j.focusKeyword} onChange={(e) => u({ focusKeyword: e.target.value })} /></td>
                    <td><input className="tk-input" value={j.imageUrl} onChange={(e) => u({ imageUrl: e.target.value })} /></td>
                    <td><input className="tk-input" value={j.categories} onChange={(e) => u({ categories: e.target.value })} /></td>
                    <td className="tk-muted">{j.content ? `${strip(j.content).split(" ").length} words` : "—"}</td>
                    <td style={{ maxWidth: 260, fontSize: 11 }}>{j.result}</td>
                    <td><button className="tk-btn sm danger" onClick={() => setJobs(jobs.filter((_, k) => k !== i))}>✕</button></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </>
      )}

      {(tab === "meta" || tab === "schema") && (
        <>
          <Card>
            <div className="tk-row">
              <button className="tk-btn primary" disabled={!!busy} onClick={loadPosts}>📥 Load latest 50 posts</button>
              {tab === "meta" && <><button className="tk-btn" disabled={!!busy || !posts.length} onClick={aiMeta}>🤖 AI rewrite meta</button><button className="tk-btn green" disabled={!!busy || !posts.length} onClick={saveMeta}>💾 Save all to WordPress</button></>}
              {tab === "schema" && <button className="tk-btn green" disabled={!!busy || !posts.length} onClick={addSchema}>🧩 Add Article JSON-LD to all</button>}
            </div>
            {tab === "schema" && <p className="tk-muted">Adds an Article JSON-LD block to posts that don&apos;t have one yet. For custom schema types use the <Link href="/schema">Schema Generator</Link>.</p>}
          </Card>
          {posts.length > 0 && (
            <div className="tk-table-wrap"><table className="tk-table">
              <thead><tr><th>Post</th>{tab === "meta" && <><th>Meta title</th><th>Meta description</th><th>Focus kw</th></>}<th>Result</th></tr></thead>
              <tbody>{posts.map((p) => (
                <tr key={p.id}>
                  <td style={{ minWidth: 200 }}><a href={p.link} target="_blank" rel="noreferrer">{strip(p.title.rendered)}</a><div className="tk-muted">{p.status} · {p.date.slice(0, 10)}</div></td>
                  {tab === "meta" && <>
                    <td><input className="tk-input" value={p.newTitle || ""} onChange={(e) => setPosts(posts.map((x) => x.id === p.id ? { ...x, newTitle: e.target.value } : x))} /><span className="tk-muted">{(p.newTitle || "").length}/60</span></td>
                    <td><textarea className="tk-textarea" style={{ minHeight: 50 }} value={p.newDesc || ""} onChange={(e) => setPosts(posts.map((x) => x.id === p.id ? { ...x, newDesc: e.target.value } : x))} /><span className="tk-muted">{(p.newDesc || "").length}/155</span></td>
                    <td><input className="tk-input" value={p.kw || ""} onChange={(e) => setPosts(posts.map((x) => x.id === p.id ? { ...x, kw: e.target.value } : x))} /></td>
                  </>}
                  <td style={{ fontSize: 12 }}>{p.result}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </Shell>
  );
}

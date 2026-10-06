// Internal link opportunity finder: crawls a site's sitemap (or given URLs),
// works out each page's target phrase, and finds pages that mention that
// phrase without linking to it.
import { NextRequest, NextResponse } from "next/server";
import { fetchPage, pool } from "@/app/lib/server/fetch-page";
import { sitemapUrls } from "@/app/lib/server/monitor";

export const maxDuration = 60;

const strip = (s: string) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;/g, " ").replace(/\s+/g, " ").trim();

function phraseFrom(title: string, siteName: string) {
  let t = title.split(/\s[|\-–—:]\s/)[0].trim();
  if (siteName && t.toLowerCase() === siteName.toLowerCase()) t = "";
  return t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export async function POST(req: NextRequest) {
  const { site, urls: given, maxPages = 40, phrases = {} } = await req.json().catch(() => ({}));
  try {
    let urls: string[] = Array.isArray(given) && given.length ? given : await sitemapUrls(site, 500);
    urls = urls.filter((u) => !/\.(jpg|jpeg|png|webp|gif|pdf|xml)$/i.test(u) && !/\/(tag|author|page)\//.test(u)).slice(0, Math.min(maxPages, 60));
    if (!urls.length) return NextResponse.json({ error: "No pages found. Check the site has a sitemap.xml, or paste page URLs." }, { status: 400 });
    const pages = (await pool(urls, 6, async (u) => {
      const p = await fetchPage(u, { timeoutMs: 12000, maxBytes: 1_500_000 });
      if (!p.ok) return null;
      const title = (p.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
      const main = p.html.match(/<(main|article)[\s\S]*?<\/\1>/i)?.[0] || p.html;
      const links = new Set([...p.html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)].map((m) => { try { return new URL(m[1], u).toString().replace(/\/$/, ""); } catch { return ""; } }));
      return { url: u.replace(/\/$/, ""), title, text: strip(main).toLowerCase(), links };
    })).filter(Boolean) as { url: string; title: string; text: string; links: Set<string> }[];
    const siteName = (pages[0]?.title.split(/\s[|\-–—]\s/).pop() || "").trim();
    const targets = pages.map((p) => ({ url: p.url, title: p.title, phrase: (phrases[p.url] || phraseFrom(p.title, siteName)).toLowerCase() })).filter((t) => t.phrase.split(" ").length >= 2 && t.phrase.length >= 6);
    const suggestions: { from: string; fromTitle: string; to: string; anchor: string; context: string }[] = [];
    for (const t of targets) {
      // Match the full phrase, or its first 2–3 significant words.
      const words = t.phrase.split(" ");
      const candidates = [t.phrase, words.slice(0, 3).join(" "), words.slice(0, 2).join(" ")].filter((c, i, a) => c.length >= 6 && a.indexOf(c) === i);
      for (const src of pages) {
        if (src.url === t.url || src.links.has(t.url)) continue;
        const hit = candidates.find((c) => src.text.includes(c));
        if (!hit) continue;
        const i = src.text.indexOf(hit);
        suggestions.push({ from: src.url, fromTitle: src.title, to: t.url, anchor: hit, context: "…" + src.text.slice(Math.max(0, i - 70), i + hit.length + 70) + "…" });
      }
    }
    const inbound = Object.fromEntries(pages.map((p) => [p.url, pages.filter((o) => o.url !== p.url && o.links.has(p.url)).length]));
    const orphans = pages.filter((p) => inbound[p.url] === 0).map((p) => ({ url: p.url, title: p.title }));
    return NextResponse.json({
      pages: pages.map((p) => ({ url: p.url, title: p.title, inbound: inbound[p.url], outbound: [...p.links].filter((l) => pages.some((o) => o.url === l)).length })),
      targets, suggestions: suggestions.slice(0, 300), orphans,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

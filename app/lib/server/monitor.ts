import { createHash } from "node:crypto";
import { fetchPage, normalizeUrl } from "./fetch-page";
import { analyzeHtml } from "./audit";

export type Snapshot = {
  at: string;
  url: string;
  up: boolean;
  status: number;
  ms: number;
  error?: string;
  title: string;
  metaDescription: string;
  h1: string;
  canonical: string;
  noindex: boolean;
  wordCount: number;
  contentHash: string;
  excerpt: string;
  sitemapUrls?: string[];
};

export async function sitemapUrls(siteUrl: string, max = 2000): Promise<string[]> {
  const origin = new URL(normalizeUrl(siteUrl)).origin;
  const robots = await fetchPage(origin + "/robots.txt", { timeoutMs: 8000, maxBytes: 100_000 });
  const fromRobots = [...robots.html.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const queue = [...new Set([...fromRobots, origin + "/sitemap.xml", origin + "/sitemap_index.xml", origin + "/wp-sitemap.xml"])];
  const urls = new Set<string>();
  const seen = new Set<string>();
  while (queue.length && seen.size < 15 && urls.size < max) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    const p = await fetchPage(sm, { timeoutMs: 10000, maxBytes: 5_000_000 });
    if (!p.ok) continue;
    const locs = [...p.html.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (/<sitemapindex/i.test(p.html)) queue.push(...locs);
    else locs.forEach((l) => urls.size < max && urls.add(l));
    if (urls.size && !/<sitemapindex/i.test(p.html) && sm.endsWith("/sitemap.xml")) break;
  }
  return [...urls];
}

export async function snapshot(url: string, withSitemap = false): Promise<Snapshot> {
  const p = await fetchPage(url);
  const a = p.html ? analyzeHtml(p.html, p.finalUrl) : null;
  const snap: Snapshot = {
    at: new Date().toISOString(), url: p.url, up: p.ok, status: p.status, ms: p.ms, error: p.error,
    title: a?.title || "", metaDescription: a?.metaDescription || "", h1: a?.h1[0] || "", canonical: a?.canonical || "",
    noindex: /noindex/i.test(a?.robotsMeta || ""), wordCount: a?.wordCount || 0,
    contentHash: createHash("sha256").update(a?.text || "").digest("hex").slice(0, 16),
    excerpt: (a?.text || "").slice(0, 600),
  };
  if (withSitemap) snap.sitemapUrls = await sitemapUrls(url).catch(() => []);
  return snap;
}

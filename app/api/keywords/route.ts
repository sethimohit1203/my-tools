// Keyword research from Google Autocomplete (free, no key): expands a seed with
// a–z and question modifiers, then classifies intent and clusters by topic.
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/app/lib/server/fetch-page";

export const maxDuration = 60;

async function suggest(q: string, gl: string, hl: string): Promise<string[]> {
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?${new URLSearchParams({ client: "firefox", q, gl, hl })}`, {
      headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
    });
    const buf = await r.arrayBuffer();
    const d = JSON.parse(new TextDecoder("utf-8").decode(buf));
    return Array.isArray(d?.[1]) ? d[1] : [];
  } catch { return []; }
}

const QUESTIONS = ["how", "what", "why", "which", "where", "when", "can", "is", "best", "cost of", "near me"];

function intent(k: string): string {
  if (/\b(buy|price|cost|cheap|deal|discount|order|book|hire|rent|rental|fees?|charges?|rates?|quote)\b/.test(k)) return "Transactional";
  if (/\bnear me\b|\bnearby\b|\bin [a-z]+$/.test(k)) return "Local";
  if (/\b(best|top|vs|review|reviews|compare|comparison|alternative|alternatives)\b/.test(k)) return "Commercial";
  if (/\b(how|what|why|which|when|where|who|guide|tips|ideas|meaning|is|can|does|tutorial|examples?)\b/.test(k)) return "Informational";
  if (/\b(login|website|contact|address|phone|official)\b/.test(k)) return "Navigational";
  return "Commercial";
}

const STOP = new Set(["the", "a", "an", "for", "in", "of", "to", "and", "or", "near", "me", "with", "is", "best", "how", "what", "why", "which", "can", "top", "on", "my", "i", "do", "does", "are", "vs"]);

export async function POST(req: NextRequest) {
  const { seed, country = "in", lang = "en", deep = true } = await req.json().catch(() => ({}));
  if (!seed?.trim()) return NextResponse.json({ error: "Enter a seed keyword" }, { status: 400 });
  const s = seed.trim().toLowerCase();
  const queries = [s, ...QUESTIONS.map((q) => (q === "near me" || q === "cost of" ? (q === "near me" ? `${s} near me` : `cost of ${s}`) : `${q} ${s}`))];
  if (deep) for (const ch of "abcdefghijklmnopqrstuvwxyz") queries.push(`${s} ${ch}`);
  const lists = await pool(queries, 8, (q) => suggest(q, country, lang));
  const all = new Map<string, { keyword: string; source: string; rank: number }>();
  lists.forEach((list, i) => list.forEach((k, rank) => {
    const kw = k.toLowerCase().trim();
    if (!all.has(kw)) all.set(kw, { keyword: kw, source: queries[i], rank });
  }));
  const seedWords = new Set(s.split(/\s+/));
  const keywords = [...all.values()].map((k) => {
    const words = k.keyword.split(/\s+/);
    const modifiers = words.filter((w) => !seedWords.has(w) && !STOP.has(w) && w.length > 2);
    return {
      ...k,
      words: words.length,
      intent: intent(k.keyword),
      type: words.length >= 4 ? "Long-tail" : words.length >= 2 ? "Mid-tail" : "Head",
      question: /^(how|what|why|which|where|when|who|can|is|does|are)\b/.test(k.keyword),
      // Popularity proxy: earlier autocomplete positions & shorter phrases are searched more.
      priority: Math.max(1, Math.round(100 - k.rank * 8 - (words.length - 2) * 6)),
      cluster: modifiers[0] || "core",
    };
  });
  const clusters: Record<string, string[]> = {};
  for (const k of keywords) (clusters[k.cluster] ||= []).push(k.keyword);
  return NextResponse.json({ keywords, clusters, queried: queries.length });
}

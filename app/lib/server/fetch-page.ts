// Fetch a public web page from the server with a timeout and a basic guard
// against hitting private/internal addresses.
import { lookup } from "node:dns/promises";
import net from "node:net";

export type FetchedPage = {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  ms: number;
  bytes: number;
  headers: Record<string, string>;
  html: string;
  error?: string;
};

const UA = "Mozilla/5.0 (compatible; MyToolsBot/1.0; +https://my-tools.vercel.app)";

export function normalizeUrl(input: string): string {
  let u = (input || "").trim();
  if (!u) throw new Error("Missing URL");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const parsed = new URL(u);
  return parsed.toString();
}

function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.");
}

export async function assertPublicUrl(url: string) {
  const { hostname, protocol } = new URL(url);
  if (!/^https?:$/.test(protocol)) throw new Error("Only http(s) URLs are allowed");
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Private addresses are not allowed");
  }
  const ip = net.isIP(hostname) ? hostname : (await lookup(hostname).catch(() => null))?.address;
  if (!ip) throw new Error(`Could not resolve ${hostname}`);
  if (isPrivateIp(ip)) throw new Error("Private addresses are not allowed");
}

export async function fetchPage(input: string, opts: { timeoutMs?: number; maxBytes?: number; method?: string } = {}): Promise<FetchedPage> {
  const url = normalizeUrl(input);
  const started = Date.now();
  const base: FetchedPage = { url, finalUrl: url, status: 0, ok: false, ms: 0, bytes: 0, headers: {}, html: "" };
  try {
    await assertPublicUrl(url);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
    const res = await fetch(url, {
      method: opts.method || "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-IN,en;q=0.9" },
      cache: "no-store",
    });
    const buf = await res.arrayBuffer();
    clearTimeout(t);
    const max = opts.maxBytes ?? 3_000_000;
    const html = new TextDecoder("utf-8").decode(buf.byteLength > max ? buf.slice(0, max) : buf);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { ...base, finalUrl: res.url || url, status: res.status, ok: res.ok, ms: Date.now() - started, bytes: buf.byteLength, headers, html };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "Timed out" : (e as Error).message;
    return { ...base, ms: Date.now() - started, error: msg };
  }
}

/** Run async jobs with a concurrency cap. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

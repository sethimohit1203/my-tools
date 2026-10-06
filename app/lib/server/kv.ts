// Tiny Upstash Redis / Vercel KV REST client (no dependency). Enabled when
// KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Upstash integration) or
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const kvEnabled = !!(URL_ && TOKEN);

async function cmd(...args: (string | number)[]) {
  if (!kvEnabled) throw new Error("Storage not configured. In Vercel → Storage, add Upstash Redis (free) to this project, then redeploy.");
  const r = await fetch(URL_!, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(args), cache: "no-store" });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const v = await cmd("GET", key);
  return v ? (JSON.parse(v) as T) : null;
}
export async function kvSet(key: string, value: unknown) { await cmd("SET", key, JSON.stringify(value)); }
export async function kvDel(key: string) { await cmd("DEL", key); }
export async function kvSAdd(key: string, member: string) { await cmd("SADD", key, member); }
export async function kvSRem(key: string, member: string) { await cmd("SREM", key, member); }
export async function kvSMembers(key: string): Promise<string[]> { return (await cmd("SMEMBERS", key)) || []; }
export async function kvLPush(key: string, value: unknown, keep = 50) { await cmd("LPUSH", key, JSON.stringify(value)); await cmd("LTRIM", key, 0, keep - 1); }
export async function kvLRange<T>(key: string, n = 20): Promise<T[]> { return ((await cmd("LRANGE", key, 0, n - 1)) || []).map((s: string) => JSON.parse(s)); }

// Boots: PGlite (real Postgres, migrations applied) → mock providers → `next start`.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { SignJWT } from "jose";
import { startMocks, state } from "./mocks.mts";

export const PG_PORT = 54329, MOCK_PORT = 9911, APP_PORT = 3457;
export const APP = `http://127.0.0.1:${APP_PORT}`, MOCK = `http://127.0.0.1:${MOCK_PORT}`;
export const ENGINE_SECRET = "test-engine-secret", JWT_SECRET = "test-jwt-secret-test-jwt-secret-123";

let app: ChildProcess | null = null;
export let sql: postgres.Sql;

export async function boot() {
  // Make sure no server from an earlier (aborted) run is still holding the port.
  try { (await import("node:child_process")).execSync(`fuser -k -9 ${APP_PORT}/tcp`, { stdio: "ignore" }); } catch { /* none running */ }
  for (let i = 0; i < 20; i++) { try { await fetch(`http://127.0.0.1:${APP_PORT}/`); await new Promise((r) => setTimeout(r, 300)); } catch { break; } }
  const pg = await PGlite.create();
  const sock = new PGLiteSocketServer({ db: pg, port: PG_PORT, host: "127.0.0.1", maxConnections: 20 } as never);
  await sock.start();
  sql = postgres(`postgres://postgres@127.0.0.1:${PG_PORT}/postgres`, { prepare: false, max: 1 });
  for (const f of readdirSync("supabase/migrations").sort()) await sql.unsafe(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await startMocks(MOCK_PORT);
  state.appUrl = APP; state.engineSecret = ENGINE_SECRET;
  app = spawn("npx", ["next", "start", "-p", String(APP_PORT)], {
    env: {
      ...process.env, NODE_ENV: "production",
      DATABASE_URL: `postgres://postgres@127.0.0.1:${PG_PORT}/postgres`, DATABASE_POOL_MAX: "1",
      ENCRYPTION_KEY: "test-encryption-key-0123456789abcdef", ENGINE_SECRET, SUPABASE_JWT_SECRET: JWT_SECRET,
      APP_URL: APP, EXTERNAL_API_OVERRIDE: MOCK, ALLOW_PRIVATE_URLS: "1", MYTOOLS_TEST: "1", ENGINE_BACKOFF_BASE_SEC: "1",
      GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stderr?.on("data", (d) => { const s = String(d); if (!/ExperimentalWarning|DeprecationWarning/.test(s)) process.stderr.write("[app] " + s); });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(APP + "/"); if (r.ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
  return { pg, sock };
}

export function shutdown() { app?.kill("SIGTERM"); }

export async function token(sub = "11111111-1111-1111-1111-111111111111", email = "owner@designoia.com") {
  return new SignJWT({ email, role: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("2h").sign(new TextEncoder().encode(JWT_SECRET));
}

export function client(tok: string) {
  return async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> => {
    const r = await fetch(APP + path, { method, headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* text */ }
    return { status: r.status, data: data as T };
  };
}

export const results: { name: string; ok: boolean; detail?: string }[] = [];
export async function test(name: string, f: () => Promise<void>) {
  const t0 = Date.now();
  try { await f(); results.push({ name, ok: true, detail: `${Date.now() - t0}ms` }); console.log(`  ✓ ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push({ name, ok: false, detail: (e as Error).message }); console.log(`  ✗ ${name}\n      ${(e as Error).message}`); }
}
export function expect(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

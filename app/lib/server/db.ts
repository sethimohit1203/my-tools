// Postgres (Supabase) connection — server only. Use the Supabase *transaction
// pooler* URL (port 6543) on Vercel; prepared statements are disabled for it.
import postgres from "postgres";

type Sql = postgres.Sql<Record<string, unknown>>;

const g = globalThis as unknown as { __mytoolsSql?: Sql };

export function dbConfigured() {
  return !!process.env.DATABASE_URL;
}

export function db(): Sql {
  if (!process.env.DATABASE_URL) throw new HttpError(503, "Database not configured. Set DATABASE_URL (Supabase → Project Settings → Database → Connection string, transaction pooler).", "not_configured");
  if (!g.__mytoolsSql) {
    g.__mytoolsSql = postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : "require",
      transform: { undefined: null },
    });
  }
  return g.__mytoolsSql;
}

export async function dbPing(): Promise<{ ok: boolean; error?: string }> {
  try { await db()`select 1`; return { ok: true }; } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) { super(message); }
}

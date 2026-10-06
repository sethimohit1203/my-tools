// Supabase Auth: verify the user's access token server-side and resolve
// (or create) their workspace. The browser only ever holds its own session.
import type { NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { db, HttpError } from "./db";

export type AuthCtx = { userId: string; email: string; workspaceId: string; role: string };

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function verify(token: string): Promise<JWTPayload> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Legacy HS256 projects (and tests) verify with the shared JWT secret;
  // projects using asymmetric signing keys verify against the JWKS.
  if (secret) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
      return payload;
    } catch (e) { if (!base) throw e; }
  }
  if (!base) throw new HttpError(503, "Supabase auth not configured (SUPABASE_URL / SUPABASE_JWT_SECRET).", "not_configured");
  jwks ||= createRemoteJWKSet(new URL(`${base.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, jwks);
  return payload;
}

export async function requireUser(req: NextRequest): Promise<AuthCtx> {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw new HttpError(401, "Sign in required", "unauthenticated");
  let p: JWTPayload;
  try { p = await verify(token); } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(401, "Session expired — sign in again", "unauthenticated");
  }
  const userId = String(p.sub || "");
  const email = String((p as { email?: string }).email || "");
  if (!userId) throw new HttpError(401, "Invalid session");
  const ws = await ensureWorkspace(userId, email);
  const pick = req.headers.get("x-workspace-id");
  if (pick && pick !== ws.workspaceId) {
    const [m] = await db()`select role from workspace_members where workspace_id = ${pick} and user_id = ${userId}`;
    if (!m) throw new HttpError(403, "Not a member of that workspace");
    return { userId, email, workspaceId: pick, role: String(m.role) };
  }
  return { userId, email, ...ws };
}

async function ensureWorkspace(userId: string, email: string) {
  const sql = db();
  const [m] = await sql`select workspace_id, role from workspace_members where user_id = ${userId} order by created_at limit 1`;
  if (m) return { workspaceId: String(m.workspace_id), role: String(m.role) };
  return sql.begin(async (tx) => {
    const [w] = await tx`insert into workspaces (name, owner_id) values (${(email.split("@")[0] || "My") + "'s workspace"}, ${userId}) returning id`;
    await tx`insert into workspace_members (workspace_id, user_id, email, role) values (${w.id}, ${userId}, ${email}, 'owner')`;
    return { workspaceId: String(w.id), role: "owner" };
  });
}

/** Optional auth: returns null instead of throwing when there's no session. */
export async function optionalUser(req: NextRequest): Promise<AuthCtx | null> {
  if (!req.headers.get("authorization")) return null;
  try { return await requireUser(req); } catch { return null; }
}

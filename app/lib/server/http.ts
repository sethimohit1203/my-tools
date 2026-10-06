// Route helpers: consistent JSON errors and auth wrappers.
import { NextRequest, NextResponse } from "next/server";
import { HttpError } from "./db";
import { requireUser, type AuthCtx } from "./auth";
import { safeEqual } from "./crypto";

export { HttpError };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code, details: e.details }, { status: e.status });
  const msg = (e as Error)?.message || String(e);
  console.error("[api]", e);
  return NextResponse.json({ error: msg }, { status: 500 });
}

type Params = Record<string, string>;
type Ctx = { params: Promise<Params> };

/** Authenticated route: resolves the user + workspace from the Supabase JWT. */
export function authed(fn: (req: NextRequest, auth: AuthCtx, params: Params) => Promise<Response | unknown>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      const auth = await requireUser(req);
      const out = await fn(req, auth, (await ctx?.params) || {});
      return out instanceof Response ? out : json(out);
    } catch (e) { return errorResponse(e); }
  };
}

/** Engine route: called by n8n with the shared ENGINE_SECRET. */
export function engine(fn: (req: NextRequest, params: Params) => Promise<Response | unknown>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      const secret = process.env.ENGINE_SECRET;
      if (!secret) throw new HttpError(503, "ENGINE_SECRET is not set", "not_configured");
      const got = req.headers.get("x-engine-secret") || "";
      if (!safeEqual(got, secret)) throw new HttpError(401, "Invalid engine secret");
      const out = await fn(req, (await ctx?.params) || {});
      return out instanceof Response ? out : json(out);
    } catch (e) { return errorResponse(e); }
  };
}

export function open(fn: (req: NextRequest, params: Params) => Promise<Response | unknown>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      const out = await fn(req, (await ctx?.params) || {});
      return out instanceof Response ? out : json(out);
    } catch (e) { return errorResponse(e); }
  };
}

export async function body<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, "Invalid JSON body"); }
}

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/app/lib/server/crypto";
import { googleExchange } from "@/app/lib/server/google";
import { appUrl } from "@/app/lib/server/env";

export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${appUrl()}/settings/integrations?${q}`);
  const st = verifyToken<{ w: string; exp: number }>(req.nextUrl.searchParams.get("state") || "");
  if (!st || st.exp < Date.now()) return back("google_error=" + encodeURIComponent("Sign-in link expired — try again"));
  const err = req.nextUrl.searchParams.get("error");
  if (err) return back("google_error=" + encodeURIComponent(err));
  try {
    await googleExchange(st.w, req.nextUrl.searchParams.get("code") || "");
    return back("google=connected");
  } catch (e) {
    return back("google_error=" + encodeURIComponent((e as Error).message));
  }
}

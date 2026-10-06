// One-click unsubscribe (RFC 8058 POST) + a confirmation page (GET).
import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/app/lib/server/crypto";
import { unsubscribe } from "@/app/lib/server/campaigns";

const page = (msg: string) => new NextResponse(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:Arial;max-width:480px;margin:60px auto;padding:0 16px;text-align:center">${msg}</body>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") || "";
  if (!verifyToken(t)) return page("<h2>Invalid or expired link</h2>");
  return page(`<h2>Unsubscribe?</h2><p>You won't receive further emails from this sender.</p><form method="post"><input type="hidden" name="t" value="${t.replace(/"/g, "")}"><button style="padding:10px 18px;font-size:15px">Unsubscribe</button></form>`);
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const t = String(form?.get("t") || req.nextUrl.searchParams.get("t") || "");
  const v = verifyToken<{ w: string; a: string; cl?: string }>(t);
  if (!v) return page("<h2>Invalid or expired link</h2>");
  await unsubscribe(v.w, v.a, v.cl);
  return page("<h2>You're unsubscribed</h2><p>You won't receive further emails from us.</p>");
}

// WhatsApp Cloud API webhook: verification (GET) and delivery/read/reply events (POST).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/app/lib/server/db";
import { decrypt, safeEqual } from "@/app/lib/server/crypto";
import { verifyMetaSignature } from "@/app/lib/server/whatsapp";
import { handleWhatsAppWebhook } from "@/app/lib/server/campaigns";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("hub.mode") !== "subscribe") return new NextResponse("Bad request", { status: 400 });
  const token = q.get("hub.verify_token") || "";
  const rows = await db()`select config->>'verify_token' as t from integrations where provider = 'whatsapp' and config ? 'verify_token'`;
  if (!rows.some((r) => r.t && safeEqual(String(r.t), token))) return new NextResponse("Invalid verify token", { status: 403 });
  return new NextResponse(q.get("hub.challenge") || "", { status: 200 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  // Verify X-Hub-Signature-256 with the app secret of the workspace that owns this phone number.
  const pid = (payload as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[] }).entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || "";
  const [i] = await db()`select secrets from integrations where provider = 'whatsapp' and config->>'phone_number_id' = ${pid}`;
  if (!i) return NextResponse.json({ error: "Unknown phone number" }, { status: 404 });
  const secret = decrypt<Record<string, string>>(i.secrets as string)?.app_secret;
  if (!secret) return NextResponse.json({ error: "App secret not configured — add it in Settings → Integrations → WhatsApp so webhook events can be verified" }, { status: 401 });
  if (!verifyMetaSignature(secret, raw, req.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await handleWhatsAppWebhook(payload)) });
  } catch (e) {
    console.error("[wa webhook]", e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

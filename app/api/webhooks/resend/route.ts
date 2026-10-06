// Resend delivery/bounce/complaint webhooks (Svix-signed).
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { db } from "@/app/lib/server/db";
import { decrypt, safeEqual } from "@/app/lib/server/crypto";
import { handleResendEvent } from "@/app/lib/server/campaigns";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const id = req.headers.get("svix-id") || "", ts = req.headers.get("svix-timestamp") || "", sigs = req.headers.get("svix-signature") || "";
  if (!id || !ts || !sigs) return NextResponse.json({ error: "Missing signature headers" }, { status: 401 });
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return NextResponse.json({ error: "Stale timestamp" }, { status: 401 });
  let evt: { type: string; data: { email_id?: string } };
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const [m] = await db()`select workspace_id from campaign_messages where provider_message_id = ${evt.data?.email_id ?? ""}`;
  if (!m) return NextResponse.json({ ok: true, matched: false });
  const [i] = await db()`select secrets from integrations where workspace_id = ${m.workspace_id} and provider = 'resend'`;
  const secret = i ? decrypt<Record<string, string>>(i.secrets as string)?.webhook_secret : undefined;
  if (!secret) return NextResponse.json({ error: "Resend webhook secret not configured" }, { status: 401 });
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  const ok = sigs.split(" ").some((s) => { const [, v] = s.split(","); return v && safeEqual(v, expected); });
  if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await handleResendEvent(evt as never)) });
}

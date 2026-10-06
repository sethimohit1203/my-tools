// Send an email through Resend (https://resend.com — free tier: 3,000/month).
import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/app/lib/server/channels";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  try {
    const id = await sendEmail(b);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

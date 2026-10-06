// Send a WhatsApp message through the official WhatsApp Business Cloud API.
import { NextRequest, NextResponse } from "next/server";
import { sendWhatsApp } from "@/app/lib/server/channels";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  try {
    const id = await sendWhatsApp(b);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

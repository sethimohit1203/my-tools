// Generic outbound webhook/HTTP call (n8n, Make, Zapier, Buffer…) for automations.
import { NextRequest, NextResponse } from "next/server";
import { httpCall } from "@/app/lib/server/channels";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await httpCall(b.url, b.method, b.body, b.headers));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Google Sheets bridge.
//  read:  any sheet shared as "Anyone with the link can view" (no key needed)
//  write: via a tiny Google Apps Script web app (code shown in the Sheets tool)
import { NextRequest, NextResponse } from "next/server";
import { readSheet, sheetsWebhook } from "@/app/lib/server/channels";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "read") return NextResponse.json({ rows: await readSheet(b.sheetUrl, b.sheet) });
    return NextResponse.json({ ok: true, result: await sheetsWebhook(b.webhookUrl, b) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

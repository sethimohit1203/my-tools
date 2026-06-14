// app/api/bot-status/route.ts
// This API endpoint receives updates from the bot via n8n
// and stores them so the dashboard can display them

import { NextRequest, NextResponse } from "next/server";

// In-memory store (resets on redeploy — for production use a DB)
// For now this is enough to see live updates during a bot session
let botResults: Record<string, unknown>[] = [];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.type === "backlink_update" && body.result) {
      const existing = botResults.findIndex((r) => (r as {id:string}).id === body.result.id);
      if (existing >= 0) botResults[existing] = body.result;
      else botResults.push(body.result);
      return NextResponse.json({ ok: true, total: botResults.length });
    }
    if (body.type === "clear") {
      botResults = [];
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ results: botResults, total: botResults.length });
}
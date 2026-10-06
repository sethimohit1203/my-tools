import { NextRequest, NextResponse } from "next/server";
import { runAI, extractJSON, type AIRequest } from "@/app/lib/server/ai";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: AIRequest;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.prompt) return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  try {
    const text = await runAI(body);
    if (body.json) return NextResponse.json({ data: extractJSON(text) });
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

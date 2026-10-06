import { NextRequest, NextResponse } from "next/server";
import { auditUrl } from "@/app/lib/server/audit";
import { pool } from "@/app/lib/server/fetch-page";

export const maxDuration = 60;

// POST { url, deep? }  → { result }
// POST { urls: [], deep? } → { results } (max 25 per call, 5 in parallel)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    if (Array.isArray(body.urls)) {
      const urls: string[] = body.urls.slice(0, 25);
      const results = await pool(urls, 5, (u) => auditUrl(u, !!body.deep).catch((e) => ({ url: u, error: String(e), score: 0 })));
      return NextResponse.json({ results });
    }
    if (!body.url) return NextResponse.json({ error: "Missing url" }, { status: 400 });
    return NextResponse.json({ result: await auditUrl(body.url, body.deep !== false) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

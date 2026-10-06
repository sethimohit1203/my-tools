// Snapshot a page (and optionally its sitemap) so the client can diff it
// against the previous snapshot.
import { NextRequest, NextResponse } from "next/server";
import { snapshot } from "@/app/lib/server/monitor";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { url, sitemap } = await req.json().catch(() => ({}));
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });
  return NextResponse.json({ snapshot: await snapshot(url, !!sitemap) });
}

// Fallback proxy for the free OpenStreetMap services, used only when the
// browser can't reach them directly (ad-blockers, strict networks).
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const ALLOWED = [
  "nominatim.openstreetmap.org", "photon.komoot.io", "overpass-api.de",
  "overpass.kumi.systems", "maps.mail.ru", "overpass.private.coffee",
];

export async function POST(req: NextRequest) {
  const { url, body } = await req.json().catch(() => ({}));
  let host = "";
  try { host = new URL(url).hostname; } catch { /* invalid */ }
  if (!ALLOWED.includes(host)) return NextResponse.json({ error: "Host not allowed" }, { status: 400 });
  try {
    const r = await fetch(url, {
      method: body ? "POST" : "GET",
      body: body || undefined,
      headers: { "User-Agent": "my-tools-maps-extractor/1.0 (vercel)", Accept: "application/json", ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      cache: "no-store",
    });
    const text = await r.text();
    return new NextResponse(text, { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

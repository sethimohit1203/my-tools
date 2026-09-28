// app/api/gmaps/osm/route.ts
// Free, keyless alternative data source: OpenStreetMap's public Nominatim search.
// No billing, no API key — but coverage/detail (phone, website, hours) depends on
// what OSM contributors have tagged, so results are sparser than Google Places.
import { NextRequest, NextResponse } from "next/server";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// Nominatim's usage policy asks for an identifying User-Agent so they can reach
// out about abuse — see https://operations.osmfoundation.org/policies/nominatim/
const USER_AGENT = "my-tools-gmaps-extractor/1.0 (+https://github.com/sethimohit1203/my-tools)";

type OSMResult = {
  place_id: number;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  class?: string;
  type?: string;
  namedetails?: { name?: string };
  address?: Record<string, string>;
  extratags?: Record<string, string>;
};

export async function POST(req: NextRequest) {
  let body: { query?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) return NextResponse.json({ error: "Missing search query" }, { status: 400 });
  const limit = Math.min(Math.max(body.limit || 25, 1), 40);

  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    extratags: "1",
    limit: String(limit),
  })}`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (!res.ok) {
      return NextResponse.json({ error: `OpenStreetMap search returned ${res.status}` }, { status: res.status });
    }
    const data: OSMResult[] = await res.json();
    return NextResponse.json({ results: data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

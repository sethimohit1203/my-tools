// app/api/gmaps/route.ts
// Server-side proxy to the official Google Places API (New) Text Search endpoint.
// Keeps this a legitimate, ToS-compliant data source (Google's own API, billed to
// the caller's own API key) instead of scraping maps.google.com directly.
import { NextRequest, NextResponse } from "next/server";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.businessStatus",
  "places.location",
  "places.types",
  "places.currentOpeningHours.openNow",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

type SearchBody = {
  apiKey: string;
  query: string;
  pageToken?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
};

export async function POST(req: NextRequest) {
  let body: SearchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { apiKey, query, pageToken, latitude, longitude, radiusMeters } = body;

  if (!apiKey) return NextResponse.json({ error: "Missing Google Places API key" }, { status: 400 });
  if (!query && !pageToken) return NextResponse.json({ error: "Missing search query" }, { status: 400 });

  const payload: Record<string, unknown> = {
    textQuery: query,
    pageSize: 20,
  };
  if (pageToken) payload.pageToken = pageToken;
  if (latitude != null && longitude != null) {
    payload.locationBias = {
      circle: {
        center: { latitude, longitude },
        radius: radiusMeters || 5000,
      },
    };
  }

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error?.message || `Google Places API returned ${res.status}` },
        { status: res.status }
      );
    }

    return NextResponse.json({
      places: data.places || [],
      nextPageToken: data.nextPageToken || null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

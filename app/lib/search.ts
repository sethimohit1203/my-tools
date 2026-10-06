"use client";
// One search entry point for both data sources, used by Lead Finder and the
// Local SEO analyzer.
import { searchOSM, type BizResult } from "./osm";
import { api } from "./settings";

type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryTypeDisplayName?: { text?: string };
  currentOpeningHours?: { openNow?: boolean };
  googleMapsUri?: string;
};

function normalizeGoogle(p: GooglePlace): BizResult {
  return {
    id: "g-" + p.id,
    name: p.displayName?.text || "",
    address: p.formattedAddress || "",
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || "",
    website: p.websiteUri || "",
    email: "",
    rating: p.rating ? `★ ${p.rating} (${p.userRatingCount || 0})` : "",
    ratingValue: p.rating,
    reviews: p.userRatingCount ?? 0,
    status: p.currentOpeningHours?.openNow == null ? (p.businessStatus === "OPERATIONAL" ? "" : p.businessStatus || "") : p.currentOpeningHours.openNow ? "Open now" : "Closed now",
    category: p.primaryTypeDisplayName?.text || (p.types || [])[0]?.replace(/_/g, " ") || "",
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    mapsLink: p.googleMapsUri || "",
    source: "google",
  };
}

export type SearchParams = {
  source: "osm" | "google";
  query: string;
  location: string;
  radiusM: number;
  limit: number;
  googleKey?: string;
  onProgress?: (s: string) => void;
};

const LL = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

export async function searchBusinesses(p: SearchParams): Promise<{ results: BizResult[]; centerLabel?: string }> {
  if (p.source === "osm") {
    const r = await searchOSM(p);
    return { results: r.results, centerLabel: r.center.label };
  }
  const loc = p.location.trim();
  const m = loc.match(LL);
  const textQuery = !loc || m ? p.query.trim() : `${p.query.trim()} in ${loc}`;
  const pages = Math.min(Math.ceil(p.limit / 20), 3);
  let token: string | undefined;
  let all: BizResult[] = [];
  for (let i = 1; i <= pages; i++) {
    p.onProgress?.(`Fetching Google Places page ${i} of ${pages}…`);
    const body: Record<string, unknown> = { apiKey: p.googleKey, query: textQuery, pageToken: token };
    if (m) { body.latitude = +m[1]; body.longitude = +m[2]; body.radiusMeters = p.radiusM; }
    const d = await api<{ places: GooglePlace[]; nextPageToken: string | null }>("/api/gmaps", body);
    all = all.concat((d.places || []).map(normalizeGoogle));
    if (!d.nextPageToken || all.length >= p.limit) break;
    token = d.nextPageToken;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { results: all.slice(0, p.limit) };
}

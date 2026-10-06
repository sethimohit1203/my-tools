// Server-side business search for workflows (OSM free, or Google Places).
import { searchOSM, type BizResult } from "../osm";
import { ActionError, providerFetch } from "./errors";
import { useIntegration } from "./integrations";

export async function mapsSearch(ws: string, o: { query: string; location: string; radiusM?: number; limit?: number; source?: string }): Promise<BizResult[]> {
  const limit = Math.min(Number(o.limit) || 20, 100), radiusM = Number(o.radiusM) || 3000;
  if (o.source === "google") {
    const i = await useIntegration(ws, "google_places");
    const { data } = await providerFetch("google_places", "https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": i.secrets.api_key, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.location,places.primaryTypeDisplayName,places.googleMapsUri" },
      body: JSON.stringify({ textQuery: `${o.query} in ${o.location}`, pageSize: Math.min(limit, 20) }),
    });
    type P = { id: string; displayName?: { text?: string }; formattedAddress?: string; nationalPhoneNumber?: string; websiteUri?: string; rating?: number; userRatingCount?: number; location?: { latitude: number; longitude: number }; primaryTypeDisplayName?: { text?: string }; googleMapsUri?: string };
    return ((data as { places?: P[] }).places || []).map((p) => ({
      id: "g-" + p.id, name: p.displayName?.text || "", address: p.formattedAddress || "", phone: p.nationalPhoneNumber || "", website: p.websiteUri || "", email: "",
      rating: p.rating ? `★ ${p.rating} (${p.userRatingCount || 0})` : "", ratingValue: p.rating, reviews: p.userRatingCount ?? 0, status: "",
      category: p.primaryTypeDisplayName?.text || "", lat: p.location?.latitude, lng: p.location?.longitude, mapsLink: p.googleMapsUri || "", source: "google" as const,
    }));
  }
  try {
    return (await searchOSM({ query: o.query, location: o.location, radiusM, limit })).results;
  } catch (e) {
    const msg = (e as Error).message;
    throw new ActionError({ service: "openstreetmap", message: msg, retryable: /busy|HTTP 5|HTTP 429|timed|abort/i.test(msg), recommendedAction: /find the place/i.test(msg) ? "Check the location spelling." : undefined });
  }
}

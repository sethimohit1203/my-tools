// Free business search on OpenStreetMap.
//
// Why the old version found nothing: it sent the whole sentence
// ("Coffee shop near geetta colony delhi") to Nominatim, which is an address
// geocoder — it can't do category searches and has no typo tolerance.
//
// New flow:
//   1. Split the query into WHAT ("coffee shop") and WHERE ("geetta colony delhi").
//   2. Geocode WHERE with Nominatim, falling back to Photon (typo-tolerant),
//      then to shorter versions of the place name.
//   3. Map WHAT to OSM tags (amenity=cafe, …) and fetch every matching POI in
//      the radius from the Overpass API (several mirrors), plus a name match.
// All three services allow browser (CORS) requests, so this runs client-side;
// /api/osm is used as a fallback proxy if the browser call is blocked.

export type BizResult = {
  id: string;
  name: string;
  address: string;
  phone: string;
  website: string;
  email: string;
  rating: string;
  ratingValue?: number;
  reviews?: number;
  status: string;
  category: string;
  lat?: number;
  lng?: number;
  mapsLink: string;
  source: "osm" | "google";
  socials?: Record<string, string>;
  distanceKm?: number;
};

type Tag = [string, string];

// keyword → OSM tags. Order matters: first match wins for multi-word keys.
const CATEGORY_TAGS: [RegExp, Tag[]][] = [
  [/coffee|cafe|café/, [["amenity", "cafe"]]],
  [/restaurant|dhaba|eatery|food|biryani|pizza|dining/, [["amenity", "restaurant"], ["amenity", "fast_food"]]],
  [/fast ?food|burger/, [["amenity", "fast_food"]]],
  [/bakery|cake/, [["shop", "bakery"], ["shop", "pastry"]]],
  [/sweet|mithai|confectioner/, [["shop", "confectionery"], ["shop", "pastry"]]],
  [/\bbars?\b|\bpubs?\b|lounge/, [["amenity", "bar"], ["amenity", "pub"]]],
  [/hotel|resort/, [["tourism", "hotel"], ["tourism", "motel"], ["tourism", "resort"]]],
  [/guest ?house|homestay|bnb/, [["tourism", "guest_house"]]],
  [/hostel|\bpg\b|paying guest/, [["tourism", "hostel"], ["building", "dormitory"]]],
  [/coaching|tuition|institute|academy|classes|training|computer centre|computer center/, [["amenity", "school"], ["amenity", "college"], ["office", "educational_institution"], ["amenity", "training"], ["amenity", "prep_school"]]],
  [/school/, [["amenity", "school"], ["amenity", "kindergarten"]]],
  [/college|university/, [["amenity", "college"], ["amenity", "university"]]],
  [/kindergarten|play ?school|preschool|creche/, [["amenity", "kindergarten"], ["amenity", "childcare"]]],
  [/music/, [["amenity", "music_school"], ["shop", "musical_instrument"]]],
  [/dance/, [["amenity", "dancing_school"], ["leisure", "dance"]]],
  [/library/, [["amenity", "library"]]],
  [/gym|fitness|yoga/, [["leisure", "fitness_centre"], ["leisure", "sports_centre"]]],
  [/sports|stadium|cricket|football|badminton/, [["leisure", "sports_centre"], ["leisure", "pitch"]]],
  [/salon|parlou?r|beauty|spa|barber/, [["shop", "beauty"], ["shop", "hairdresser"], ["leisure", "spa"]]],
  [/hospital/, [["amenity", "hospital"]]],
  [/clinic|doctor|physio|diagnostic|lab\b/, [["amenity", "clinic"], ["amenity", "doctors"], ["healthcare", "laboratory"]]],
  [/dentist|dental/, [["amenity", "dentist"]]],
  [/pharmacy|chemist|medical store/, [["amenity", "pharmacy"], ["shop", "chemist"]]],
  [/\bvet|\bpets?\b/, [["amenity", "veterinary"], ["shop", "pet"]]],
  [/real ?estate|property|broker/, [["office", "estate_agent"]]],
  [/car rental|cab|taxi|travel agen|tour/, [["amenity", "car_rental"], ["amenity", "taxi"], ["shop", "travel_agency"], ["office", "travel_agent"]]],
  [/car (?:dealer|showroom)|car repair|garage|mechanic/, [["shop", "car"], ["shop", "car_repair"]]],
  [/bike|motorcycle|scooter/, [["shop", "motorcycle"], ["shop", "bicycle"], ["shop", "motorcycle_repair"]]],
  [/mobile|phone|electronics|computer shop|laptop/, [["shop", "mobile_phone"], ["shop", "electronics"], ["shop", "computer"]]],
  [/stationery|book ?shop|bookstore/, [["shop", "stationery"], ["shop", "books"]]],
  [/gift|toy/, [["shop", "gift"], ["shop", "toys"]]],
  [/cosmetic|perfume/, [["shop", "cosmetics"], ["shop", "perfumery"]]],
  [/cloth|garment|boutique|fashion|apparel|tailor/, [["shop", "clothes"], ["shop", "boutique"], ["shop", "tailor"], ["shop", "fabric"]]],
  [/jewel/, [["shop", "jewelry"]]],
  [/shoe|footwear/, [["shop", "shoes"]]],
  [/furniture|interior/, [["shop", "furniture"], ["shop", "interior_decoration"]]],
  [/hardware|paint|sanitary/, [["shop", "hardware"], ["shop", "doityourself"], ["shop", "paint"]]],
  [/grocery|kirana|supermarket|general store/, [["shop", "supermarket"], ["shop", "convenience"], ["shop", "grocery"]]],
  [/wholesale|supplier|distributor/, [["shop", "wholesale"], ["office", "company"]]],
  [/optic|eyewear|spectacle/, [["shop", "optician"]]],
  [/laundry|dry ?clean/, [["shop", "laundry"], ["shop", "dry_cleaning"]]],
  [/bank|atm/, [["amenity", "bank"]]],
  [/lawyer|advocate|legal/, [["office", "lawyer"]]],
  [/\bca\b|accountant|chartered/, [["office", "accountant"], ["office", "tax_advisor"]]],
  [/wedding|banquet|event|marriage hall/, [["amenity", "events_venue"], ["shop", "wedding"], ["amenity", "community_centre"]]],
  [/photo|studio/, [["shop", "photo"], ["craft", "photographer"]]],
  [/petrol|fuel|gas station/, [["amenity", "fuel"]]],
  [/temple|mandir|gurudwara|church|mosque/, [["amenity", "place_of_worship"]]],
  [/office|company|agency|it company|software/, [["office", "company"], ["office", "it"]]],
];

export function tagsFor(what: string): Tag[] {
  const w = what.toLowerCase();
  for (const [re, tags] of CATEGORY_TAGS) if (re.test(w)) return tags;
  return [];
}

const SPLIT_RE = /\s+(?:near(?:\s+me)?|in|at|around|nearby|close to|within)\s+/i;

export function splitQuery(query: string, location: string): { what: string; where: string } {
  const q = query.trim();
  if (location.trim()) return { what: q.replace(/\s+near\s+me$/i, ""), where: location.trim() };
  const m = q.split(SPLIT_RE);
  if (m.length >= 2) return { what: m[0].trim(), where: m.slice(1).join(" ").trim() };
  return { what: q, where: "" };
}

type Geo = { lat: number; lng: number; label: string };

async function getJSON(url: string, init?: RequestInit, timeoutMs = 25000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Browser first, then our server proxy (for ad-blockers / strict networks). */
async function viaProxy(target: string, body?: string): Promise<unknown> {
  try {
    return await getJSON(target, body ? { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } } : { headers: { Accept: "application/json" } }, body ? 60000 : 20000);
  } catch (browserErr) {
    try {
      return await getJSON("/api/osm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: target, body }) }, 60000);
    } catch {
      throw browserErr;
    }
  }
}

export async function geocode(place: string): Promise<Geo | null> {
  const LL = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(place);
  if (LL) return { lat: parseFloat(LL[1]), lng: parseFloat(LL[2]), label: place };
  const words = place.split(/[\s,]+/).filter(Boolean);
  // Try the full phrase, then progressively drop the first word ("geetta colony delhi" → "colony delhi" → "delhi")
  const attempts = [place];
  for (let i = 1; i < words.length; i++) attempts.push(words.slice(i).join(" "));
  for (const a of attempts.slice(0, 3)) {
    try {
      const n = (await viaProxy(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: a, format: "jsonv2", limit: "1" })}`)) as { lat: string; lon: string; display_name: string }[];
      if (n?.[0]) return { lat: +n[0].lat, lng: +n[0].lon, label: n[0].display_name };
    } catch { /* try photon */ }
    try {
      const p = (await viaProxy(`https://photon.komoot.io/api/?${new URLSearchParams({ q: a, limit: "1" })}`)) as { features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] };
      const f = p?.features?.[0];
      if (f) {
        const pr = f.properties;
        return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: [pr.name, pr.district, pr.city, pr.state, pr.country].filter(Boolean).join(", ") };
      }
    } catch { /* next attempt */ }
  }
  return null;
}

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

type OverpassEl = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

async function overpass(ql: string): Promise<OverpassEl[]> {
  let last: unknown;
  for (const ep of OVERPASS) {
    try {
      const d = (await viaProxy(ep, "data=" + encodeURIComponent(ql))) as { elements?: OverpassEl[] };
      return d.elements || [];
    } catch (e) { last = e; }
  }
  throw new Error(`OpenStreetMap servers are busy (${(last as Error)?.message || "error"}). Try again in a minute.`);
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function normalize(el: OverpassEl, center: Geo): BizResult {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  const addr = [t["addr:housenumber"], t["addr:street"], t["addr:suburb"] || t["addr:neighbourhood"], t["addr:city"] || t["addr:district"], t["addr:postcode"]].filter(Boolean).join(", ");
  const kind = t.amenity || t.shop || t.tourism || t.leisure || t.office || t.healthcare || t.craft || "";
  const socials: Record<string, string> = {};
  for (const k of ["facebook", "instagram", "youtube", "linkedin", "twitter"]) {
    const v = t[`contact:${k}`] || t[k];
    if (v) socials[k] = v;
  }
  return {
    id: `osm-${el.type}-${el.id}`,
    name: t.name || t["name:en"] || t.brand || "(unnamed)",
    address: addr || t["addr:full"] || "",
    phone: t.phone || t["contact:phone"] || t["contact:mobile"] || t.mobile || "",
    website: t.website || t["contact:website"] || t.url || "",
    email: t.email || t["contact:email"] || "",
    rating: "",
    status: t.opening_hours || "",
    category: [kind.replace(/_/g, " "), t.cuisine?.replace(/[_;]/g, " ")].filter(Boolean).join(" · "),
    lat, lng,
    mapsLink: lat != null ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((t.name || "") + " " + lat + "," + lng)}` : `https://www.openstreetmap.org/${el.type}/${el.id}`,
    source: "osm",
    socials,
    distanceKm: lat != null && lng != null ? Math.round(km(center, { lat, lng }) * 10) / 10 : undefined,
  };
}

export type OsmSearch = { query: string; location: string; radiusM: number; limit: number; onProgress?: (s: string) => void };

export async function searchOSM({ query, location, radiusM, limit, onProgress }: OsmSearch): Promise<{ results: BizResult[]; center: Geo; what: string }> {
  const { what, where } = splitQuery(query, location);
  if (!where) throw new Error('Add a location — e.g. "coffee shop near Geeta Colony, Delhi", or fill the Location box (or use 🎯 for your current location).');
  onProgress?.(`Finding "${where}" on the map…`);
  const center = await geocode(where);
  if (!center) throw new Error(`Couldn't find the place "${where}". Check the spelling or try a bigger area (e.g. just the city).`);

  const tags = tagsFor(what);
  const words = what.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["shop", "shops", "store", "near", "best", "top", "the", "and", "for"].includes(w));
  const around = `(around:${radiusM},${center.lat},${center.lng})`;
  const parts: string[] = tags.map(([k, v]) => `nwr["${k}"="${v}"]${around};`);
  // Name match catches businesses whose category tag is missing; strip plurals ("schools" → "school").
  const stems = words.map((w) => w.replace(/[^a-z0-9]/g, "").replace(/(?<=.{3})(es|s)$/, "")).filter(Boolean);
  if (stems.length) parts.push(`nwr["name"~"${stems.join("|")}",i]${around};`);
  if (!parts.length) throw new Error("Describe the business type, e.g. \"cafe\", \"school\", \"salon\".");

  onProgress?.(`Searching businesses within ${radiusM / 1000} km of ${center.label.split(",").slice(0, 2).join(",")}…`);
  const ql = `[out:json][timeout:40];(${parts.join("")});out tags center ${Math.min(limit * 3, 600)};`;
  const els = await overpass(ql);
  const seen = new Set<string>();
  const results = els
    .filter((e) => e.tags?.name)
    .map((e) => normalize(e, center))
    .filter((r) => { const k = r.name.toLowerCase() + "|" + (r.lat?.toFixed(3) ?? ""); if (seen.has(k)) return false; seen.add(k); return true; })
    // Richest records first (phone/website), then nearest.
    .sort((a, b) => (Number(!!b.phone) + Number(!!b.website)) - (Number(!!a.phone) + Number(!!a.website)) || (a.distanceKm ?? 99) - (b.distanceKm ?? 99))
    .slice(0, limit);
  return { results, center, what };
}

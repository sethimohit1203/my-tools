"use client";
import { useState } from "react";
import { Banner, Card, CopyButton, Field, Shell, Tabs } from "../lib/ui";
import { aiJSON } from "../lib/settings";

type Kind = "LocalBusiness" | "Organization" | "Article" | "FAQPage" | "Product" | "BreadcrumbList" | "Event" | "Course" | "Service" | "HowTo";

type F = { key: string; label: string; ph?: string; area?: boolean };

const FIELDS: Record<Kind, F[]> = {
  LocalBusiness: [
    { key: "subtype", label: "Business type (schema.org)", ph: "Restaurant, Dentist, AutoRental, Hotel, School…" },
    { key: "name", label: "Name" }, { key: "url", label: "Website URL" }, { key: "image", label: "Logo / photo URL" },
    { key: "telephone", label: "Phone", ph: "+91-98xxxxxxx" }, { key: "email", label: "Email" },
    { key: "street", label: "Street address" }, { key: "locality", label: "City", ph: "New Delhi" }, { key: "region", label: "State", ph: "Delhi" },
    { key: "postal", label: "PIN code" }, { key: "lat", label: "Latitude" }, { key: "lng", label: "Longitude" },
    { key: "hours", label: "Opening hours", ph: "Mo-Sa 09:00-19:00" }, { key: "price", label: "Price range", ph: "₹₹" },
    { key: "rating", label: "Rating value", ph: "4.6" }, { key: "reviews", label: "Review count", ph: "128" },
    { key: "sameAs", label: "Social profile URLs (one per line)", area: true },
  ],
  Organization: [{ key: "name", label: "Name" }, { key: "url", label: "URL" }, { key: "logo", label: "Logo URL" }, { key: "telephone", label: "Phone" }, { key: "email", label: "Email" }, { key: "sameAs", label: "Social profile URLs (one per line)", area: true }],
  Article: [{ key: "headline", label: "Headline" }, { key: "url", label: "Article URL" }, { key: "image", label: "Image URL" }, { key: "author", label: "Author name" }, { key: "publisher", label: "Publisher name" }, { key: "logo", label: "Publisher logo URL" }, { key: "published", label: "Date published", ph: "2026-10-06" }, { key: "modified", label: "Date modified" }, { key: "description", label: "Description", area: true }],
  FAQPage: [{ key: "faq", label: "Questions & answers — format: Q: … then A: … (blank line between)", area: true, ph: "Q: How much does a website cost?\nA: Starts at ₹15,000.\n\nQ: How long does it take?\nA: 2–4 weeks." }],
  Product: [{ key: "name", label: "Product name" }, { key: "image", label: "Image URL" }, { key: "description", label: "Description", area: true }, { key: "brand", label: "Brand" }, { key: "sku", label: "SKU" }, { key: "price", label: "Price", ph: "499" }, { key: "currency", label: "Currency", ph: "INR" }, { key: "availability", label: "Availability", ph: "InStock" }, { key: "url", label: "Product URL" }, { key: "rating", label: "Rating value" }, { key: "reviews", label: "Review count" }],
  BreadcrumbList: [{ key: "crumbs", label: "One per line: Name | URL", area: true, ph: "Home | https://site.com/\nBlog | https://site.com/blog/\nPost | https://site.com/blog/post/" }],
  Event: [{ key: "name", label: "Event name" }, { key: "start", label: "Start (ISO)", ph: "2026-11-15T10:00:00+05:30" }, { key: "end", label: "End (ISO)" }, { key: "venue", label: "Venue name" }, { key: "address", label: "Venue address" }, { key: "mode", label: "Attendance mode", ph: "Offline / Online / Mixed" }, { key: "image", label: "Image URL" }, { key: "description", label: "Description", area: true }, { key: "organizer", label: "Organizer" }, { key: "price", label: "Ticket price", ph: "0" }, { key: "url", label: "Ticket/registration URL" }],
  Course: [{ key: "name", label: "Course name" }, { key: "description", label: "Description", area: true }, { key: "provider", label: "Provider (organization)" }, { key: "url", label: "Provider URL" }, { key: "mode", label: "Course mode", ph: "onsite / online / blended" }, { key: "price", label: "Price (INR)" }],
  Service: [{ key: "name", label: "Service name", ph: "Website Design" }, { key: "serviceType", label: "Service type" }, { key: "provider", label: "Provider name" }, { key: "area", label: "Area served", ph: "Delhi NCR" }, { key: "description", label: "Description", area: true }, { key: "price", label: "Starting price (INR)" }, { key: "url", label: "Page URL" }],
  HowTo: [{ key: "name", label: "Title" }, { key: "description", label: "Description", area: true }, { key: "time", label: "Total time (ISO 8601)", ph: "PT30M" }, { key: "steps", label: "Steps (one per line)", area: true }],
};

const clean = (o: unknown): unknown => {
  if (Array.isArray(o)) { const a = o.map(clean).filter((x) => x !== undefined); return a.length ? a : undefined; }
  if (o && typeof o === "object") {
    const e = Object.entries(o).map(([k, v]) => [k, clean(v)] as const).filter(([, v]) => v !== undefined);
    return e.some(([k]) => !k.startsWith("@")) ? Object.fromEntries(e) : undefined;
  }
  return o === "" || o == null ? undefined : o;
};

function build(kind: Kind, v: Record<string, string>) {
  const lines = (s = "") => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const rating = v.rating ? { "@type": "AggregateRating", ratingValue: v.rating, reviewCount: v.reviews } : undefined;
  switch (kind) {
    case "LocalBusiness": return {
      "@type": v.subtype?.trim() || "LocalBusiness", name: v.name, url: v.url, image: v.image, telephone: v.telephone, email: v.email, priceRange: v.price,
      address: { "@type": "PostalAddress", streetAddress: v.street, addressLocality: v.locality, addressRegion: v.region, postalCode: v.postal, addressCountry: "IN" },
      geo: v.lat ? { "@type": "GeoCoordinates", latitude: v.lat, longitude: v.lng } : undefined, openingHours: v.hours, aggregateRating: rating, sameAs: lines(v.sameAs),
    };
    case "Organization": return { "@type": "Organization", name: v.name, url: v.url, logo: v.logo, sameAs: lines(v.sameAs), contactPoint: v.telephone ? { "@type": "ContactPoint", telephone: v.telephone, email: v.email, contactType: "customer service" } : undefined };
    case "Article": return { "@type": "Article", headline: v.headline, image: v.image, description: v.description, datePublished: v.published, dateModified: v.modified || v.published, mainEntityOfPage: v.url, author: { "@type": "Person", name: v.author }, publisher: { "@type": "Organization", name: v.publisher, logo: v.logo ? { "@type": "ImageObject", url: v.logo } : undefined } };
    case "FAQPage": return { "@type": "FAQPage", mainEntity: (v.faq || "").split(/\n\s*\n/).map((b) => { const q = b.match(/Q:\s*([\s\S]*?)(?:\n|$)/i)?.[1]?.trim(); const a = b.match(/A:\s*([\s\S]*)/i)?.[1]?.trim(); return q && a ? { "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } } : null; }).filter(Boolean) };
    case "Product": return { "@type": "Product", name: v.name, image: v.image, description: v.description, sku: v.sku, brand: v.brand ? { "@type": "Brand", name: v.brand } : undefined, offers: v.price ? { "@type": "Offer", price: v.price, priceCurrency: v.currency || "INR", availability: `https://schema.org/${v.availability || "InStock"}`, url: v.url } : undefined, aggregateRating: rating };
    case "BreadcrumbList": return { "@type": "BreadcrumbList", itemListElement: lines(v.crumbs).map((l, i) => { const [name, item] = l.split("|").map((x) => x.trim()); return { "@type": "ListItem", position: i + 1, name, item }; }) };
    case "Event": return { "@type": "Event", name: v.name, startDate: v.start, endDate: v.end, image: v.image, description: v.description, eventAttendanceMode: `https://schema.org/${/online/i.test(v.mode) ? "Online" : /mix/i.test(v.mode) ? "Mixed" : "Offline"}EventAttendanceMode`, eventStatus: "https://schema.org/EventScheduled", location: { "@type": "Place", name: v.venue, address: v.address }, organizer: v.organizer ? { "@type": "Organization", name: v.organizer } : undefined, offers: v.price ? { "@type": "Offer", price: v.price, priceCurrency: "INR", url: v.url, availability: "https://schema.org/InStock" } : undefined };
    case "Course": return { "@type": "Course", name: v.name, description: v.description, provider: { "@type": "Organization", name: v.provider, sameAs: v.url }, hasCourseInstance: v.mode ? { "@type": "CourseInstance", courseMode: v.mode } : undefined, offers: v.price ? { "@type": "Offer", price: v.price, priceCurrency: "INR", category: "Paid" } : undefined };
    case "Service": return { "@type": "Service", name: v.name, serviceType: v.serviceType, description: v.description, url: v.url, provider: { "@type": "Organization", name: v.provider }, areaServed: v.area, offers: v.price ? { "@type": "Offer", price: v.price, priceCurrency: "INR" } : undefined };
    case "HowTo": return { "@type": "HowTo", name: v.name, description: v.description, totalTime: v.time, step: lines(v.steps).map((s, i) => ({ "@type": "HowToStep", position: i + 1, text: s })) };
  }
}

export default function SchemaPage() {
  const [kind, setKind] = useState<Kind>("LocalBusiness");
  const [vals, setVals] = useState<Record<Kind, Record<string, string>>>({} as Record<Kind, Record<string, string>>);
  const [aiText, setAiText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const v = vals[kind] || {};
  const json = JSON.stringify(clean({ "@context": "https://schema.org", ...build(kind, v) }) || {}, null, 2);
  const snippet = `<script type="application/ld+json">\n${json}\n</script>`;

  async function aiFill() {
    if (!aiText.trim()) return;
    setBusy(true); setErr("");
    try {
      const keys = FIELDS[kind].map((f) => f.key);
      const r = await aiJSON<Record<string, string>>(`Extract values for a schema.org ${kind} from this text/page content. Return a flat JSON object with only these string keys: ${keys.join(", ")}. Use "" when unknown. For multi-line fields keep the format described: ${FIELDS[kind].filter((f) => f.ph?.includes("\n")).map((f) => `${f.key}: ${JSON.stringify(f.ph)}`).join("; ")}\n\nText:\n${aiText.slice(0, 12000)}`);
      setVals({ ...vals, [kind]: { ...v, ...Object.fromEntries(Object.entries(r).map(([k, x]) => [k, String(x ?? "")])) } });
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <Shell icon="🧩" title="Schema Generator" desc="Generate valid JSON-LD structured data for rich results. Paste the snippet into the page <head> (or Rank Math → Schema → Custom) and verify with Google's Rich Results Test.">
      <Tabs value={kind} onChange={setKind} items={(Object.keys(FIELDS) as Kind[]).map((k) => ({ id: k, label: k }))} />
      <div className="tk-grid" style={{ ["--min" as string]: "380px", alignItems: "start" }}>
        <div>
          <Card title="🤖 Auto-fill with AI (optional)">
            <textarea className="tk-textarea" placeholder="Paste the page text, Google Business Profile details, or product description…" value={aiText} onChange={(e) => setAiText(e.target.value)} />
            <button className="tk-btn" style={{ marginTop: 8 }} disabled={busy} onClick={aiFill}>{busy ? "⏳ Extracting…" : "Fill fields"}</button>
            {err && <Banner tone="err">{err}</Banner>}
          </Card>
          <Card title={`${kind} fields`}>
            <div className="tk-grid" style={{ ["--min" as string]: "170px" }}>
              {FIELDS[kind].map((f) => (
                <div key={f.key} style={f.area ? { gridColumn: "1 / -1" } : undefined}>
                  <Field label={f.label}>
                    {f.area
                      ? <textarea className="tk-textarea" placeholder={f.ph} value={v[f.key] || ""} onChange={(e) => setVals({ ...vals, [kind]: { ...v, [f.key]: e.target.value } })} />
                      : <input className="tk-input" placeholder={f.ph} value={v[f.key] || ""} onChange={(e) => setVals({ ...vals, [kind]: { ...v, [f.key]: e.target.value } })} />}
                  </Field>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <Card title="JSON-LD" actions={<><CopyButton text={snippet} label="Copy <script>" /><CopyButton text={json} label="Copy JSON" /><a className="tk-btn sm" target="_blank" rel="noreferrer" href="https://search.google.com/test/rich-results">Test ↗</a></>}>
          <pre className="tk-pre tk-code" style={{ maxHeight: 640, overflow: "auto" }}>{snippet}</pre>
        </Card>
      </div>
    </Shell>
  );
}

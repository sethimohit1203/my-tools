// Website audit engine: fetches a page and scores SEO, technical, mobile,
// conversion/UX and social signals. Pure regex parsing — no headless browser —
// so it runs fine inside a Vercel serverless function.
import { fetchPage, pool } from "./fetch-page";

export type Check = { id: string; label: string; pass: boolean; weight: number; category: "seo" | "technical" | "mobile" | "conversion" | "social"; tip: string; detail?: string };

export type AuditResult = {
  url: string;
  finalUrl: string;
  status: number;
  error?: string;
  ms: number;
  bytes: number;
  score: number;
  categoryScores: Record<Check["category"], number>;
  title: string;
  metaDescription: string;
  h1: string[];
  h2Count: number;
  wordCount: number;
  images: number;
  imagesMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  canonical: string;
  lang: string;
  schemaTypes: string[];
  phones: string[];
  emails: string[];
  social: Record<string, string>;
  platform: string;
  hasWhatsApp: boolean;
  hasContactForm: boolean;
  hasMap: boolean;
  hasBooking: boolean;
  robotsTxt?: boolean;
  sitemap?: boolean;
  brokenLinks?: { url: string; status: number }[];
  checks: Check[];
  services: string[];
};

const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

function meta(html: string, name: string) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0] || "";
  return tag.match(/content=["']([^"']*)["']/i)?.[1]?.trim() || "";
}

const SOCIAL: Record<string, RegExp> = {
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.\-/]+/i,
  facebook: /https?:\/\/(?:www\.|m\.)?facebook\.com\/[A-Za-z0-9_.\-/?=]+/i,
  youtube: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/|user\/)[A-Za-z0-9_.\-]+/i,
  linkedin: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9_.\-]+/i,
  twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]+/i,
};

export function analyzeHtml(html: string, pageUrl: string) {
  const head = html.slice(0, 200_000);
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const text = strip(body);
  const title = strip(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const metaDescription = meta(head, "description");
  const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1])).filter(Boolean);
  const h2Count = (html.match(/<h2[\s>]/gi) || []).length;
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const imagesMissingAlt = imgs.filter((t) => !/\balt=["'][^"']+["']/i.test(t)).length;
  let host = "";
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
  const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  let internalLinks = 0, externalLinks = 0;
  const internalUrls: string[] = [];
  for (const h of hrefs) {
    if (/^(mailto|tel|javascript|whatsapp):/i.test(h)) continue;
    try {
      const u = new URL(h, pageUrl);
      if (u.hostname.replace(/^www\./, "") === host) { internalLinks++; internalUrls.push(u.toString()); } else externalLinks++;
    } catch { /* ignore */ }
  }
  const schemaTypes = [...new Set([...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))].slice(0, 12);
  const phones = [...new Set([...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => m[1].trim()))].slice(0, 5);
  const emails = [...new Set([...html.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]).filter((e) => !/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(e) && !/sentry|example|wixpress|domain\.com/i.test(e)))].slice(0, 5);
  const social: Record<string, string> = {};
  for (const [k, re] of Object.entries(SOCIAL)) { const m = html.match(re); if (m) social[k] = m[0]; }
  const platform =
    /wp-content|wp-includes/i.test(html) ? "WordPress" :
    /cdn\.shopify|Shopify\.theme/i.test(html) ? "Shopify" :
    /wix\.com|_wixCssImports|wixstatic/i.test(html) ? "Wix" :
    /squarespace/i.test(html) ? "Squarespace" :
    /webflow/i.test(html) ? "Webflow" :
    /__next|_next\/static/i.test(html) ? "Next.js" :
    /blogger\.com|blogspot/i.test(html) ? "Blogger" :
    /godaddy|img1\.wsimg/i.test(html) ? "GoDaddy Builder" : "Custom / unknown";
  return {
    title, metaDescription, h1, h2Count, text, wordCount: text ? text.split(" ").length : 0,
    images: imgs.length, imagesMissingAlt, internalLinks, externalLinks, internalUrls,
    canonical: head.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] || head.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1] || "",
    lang: html.match(/<html[^>]*\blang=["']([^"']+)["']/i)?.[1] || "",
    viewport: /<meta[^>]+name=["']viewport["']/i.test(head),
    ogTitle: meta(head, "og:title"), ogImage: meta(head, "og:image"),
    robotsMeta: meta(head, "robots"),
    favicon: /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(head),
    schemaTypes, phones, emails, social, platform,
    hasWhatsApp: /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\/|web\.whatsapp\.com/i.test(html),
    hasContactForm: /<form[\s\S]{0,4000}?(?:type=["']email["']|name=["'][^"']*(?:email|phone|message|name)[^"']*["'])/i.test(html) || /wpcf7|wpforms|gform_|elementor-form|formspree|hsforms/i.test(html),
    hasMap: /google\.com\/maps|maps\.googleapis|goo\.gl\/maps|maps\.app\.goo\.gl|openstreetmap/i.test(html),
    hasBooking: /book(?:ing)?\s*(?:now|online|a\s+table|appointment)|reserve\s+now|check\s*availability|calendly|simplybook|booking\.com\/hotel|cloudbeds|ezee|setmore/i.test(text + " " + html.slice(0, 50000)),
    hasAnalytics: /gtag\(|googletagmanager|google-analytics|fbq\(/i.test(html),
    inlineCss: (html.match(/<style/gi) || []).length,
    scripts: (html.match(/<script\b/gi) || []).length,
    copyrightYear: Number((text.match(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/i) || [])[1] || 0),
  };
}

export async function auditUrl(input: string, deep = false): Promise<AuditResult> {
  const page = await fetchPage(input);
  const empty = {
    url: page.url, finalUrl: page.finalUrl, status: page.status, ms: page.ms, bytes: page.bytes,
    title: "", metaDescription: "", h1: [], h2Count: 0, wordCount: 0, images: 0, imagesMissingAlt: 0,
    internalLinks: 0, externalLinks: 0, canonical: "", lang: "", schemaTypes: [], phones: [], emails: [],
    social: {}, platform: "", hasWhatsApp: false, hasContactForm: false, hasMap: false, hasBooking: false,
  };
  if (page.error || !page.html) {
    return { ...empty, error: page.error || `HTTP ${page.status}`, score: 0, categoryScores: { seo: 0, technical: 0, mobile: 0, conversion: 0, social: 0 }, checks: [], services: ["Website development (site unreachable)"] };
  }
  const a = analyzeHtml(page.html, page.finalUrl);
  const https = page.finalUrl.startsWith("https://");
  const year = new Date().getFullYear();
  const C = (id: string, label: string, pass: boolean, weight: number, category: Check["category"], tip: string, detail?: string): Check => ({ id, label, pass, weight, category, tip, detail });
  const checks: Check[] = [
    C("https", "Uses HTTPS", https, 8, "technical", "Install an SSL certificate and redirect http → https."),
    C("status", "Page returns 200 OK", page.status === 200, 6, "technical", "Fix server errors / redirects on the homepage.", `HTTP ${page.status}`),
    C("speed", "Server responds in under 2.5s", page.ms < 2500, 6, "technical", "Improve hosting, enable caching and a CDN.", `${(page.ms / 1000).toFixed(2)}s`),
    C("weight", "HTML under 500 KB", page.bytes < 500_000, 3, "technical", "Reduce inline scripts/CSS and page builder bloat.", `${Math.round(page.bytes / 1024)} KB`),
    C("analytics", "Analytics / tracking installed", a.hasAnalytics, 3, "technical", "Install Google Analytics 4 and Search Console."),
    C("viewport", "Mobile viewport meta tag", a.viewport, 10, "mobile", "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> and a responsive layout."),
    C("favicon", "Has a favicon", a.favicon, 2, "mobile", "Add a favicon / app icon for brand trust."),
    C("title", "Title tag 20–65 chars", a.title.length >= 20 && a.title.length <= 65, 8, "seo", "Write a unique title with the main keyword + city.", a.title ? `${a.title.length} chars` : "missing"),
    C("desc", "Meta description 70–160 chars", a.metaDescription.length >= 70 && a.metaDescription.length <= 160, 7, "seo", "Add a persuasive meta description with a call-to-action.", a.metaDescription ? `${a.metaDescription.length} chars` : "missing"),
    C("h1", "Exactly one H1 heading", a.h1.length === 1, 6, "seo", "Use one clear H1 describing the business/service.", `${a.h1.length} found`),
    C("h2", "Uses H2 subheadings", a.h2Count > 0, 3, "seo", "Structure content with H2 sections for each service."),
    C("content", "At least 300 words of content", a.wordCount >= 300, 6, "seo", "Add service descriptions, FAQs and location content.", `${a.wordCount} words`),
    C("alt", "Images have alt text", a.images === 0 || a.imagesMissingAlt / a.images < 0.2, 4, "seo", "Add descriptive alt text to images.", `${a.imagesMissingAlt}/${a.images} missing`),
    C("canonical", "Canonical tag set", !!a.canonical, 3, "seo", "Add a canonical URL to avoid duplicate content."),
    C("schema", "Structured data (schema.org)", a.schemaTypes.length > 0, 5, "seo", "Add LocalBusiness / Organization JSON-LD schema.", a.schemaTypes.join(", ")),
    C("og", "Open Graph tags for sharing", !!(a.ogTitle && a.ogImage), 2, "social", "Add og:title / og:image so shares look good on WhatsApp & Facebook."),
    C("noindex", "Not blocked from Google (noindex)", !/noindex/i.test(a.robotsMeta), 6, "seo", "Remove the noindex robots meta tag."),
    C("phone", "Click-to-call phone link", a.phones.length > 0, 5, "conversion", "Add a tap-to-call tel: link in the header."),
    C("whatsapp", "WhatsApp chat button", a.hasWhatsApp, 5, "conversion", "Add a floating WhatsApp chat button (wa.me link)."),
    C("form", "Contact / enquiry form", a.hasContactForm, 5, "conversion", "Add an enquiry form that sends leads to email/CRM."),
    C("map", "Google Map / directions", a.hasMap, 3, "conversion", "Embed a Google Map and link to the Business Profile."),
    C("fresh", "Copyright year looks current", !a.copyrightYear || a.copyrightYear >= year - 1, 2, "conversion", "Update the footer — an old year makes the site look abandoned.", a.copyrightYear ? String(a.copyrightYear) : ""),
    C("social", "Links to social profiles", Object.keys(a.social).length >= 2, 4, "social", "Link Instagram / Facebook / YouTube / LinkedIn profiles.", Object.keys(a.social).join(", ")),
  ];

  let robotsTxt: boolean | undefined, sitemap: boolean | undefined, brokenLinks: { url: string; status: number }[] | undefined;
  if (deep) {
    const origin = new URL(page.finalUrl).origin;
    const [r, s] = await Promise.all([fetchPage(origin + "/robots.txt", { timeoutMs: 8000, maxBytes: 100_000 }), fetchPage(origin + "/sitemap.xml", { timeoutMs: 8000, maxBytes: 200_000 })]);
    robotsTxt = r.status === 200 && !/<html/i.test(r.html);
    sitemap = (s.status === 200 && /<(urlset|sitemapindex)/i.test(s.html)) || /sitemap:/i.test(r.html);
    checks.push(C("robots", "robots.txt present", robotsTxt, 2, "technical", "Add a robots.txt that references your sitemap."));
    checks.push(C("sitemap", "XML sitemap present", sitemap, 4, "seo", "Generate an XML sitemap and submit it to Google Search Console."));
    const sample = [...new Set(a.internalUrls)].slice(0, 12);
    const results = await pool(sample, 4, async (u) => {
      const p = await fetchPage(u, { timeoutMs: 8000, maxBytes: 50_000 });
      return { url: u, status: p.status };
    });
    brokenLinks = results.filter((x) => x.status === 0 || x.status >= 400);
    checks.push(C("broken", "No broken internal links (sample)", brokenLinks.length === 0, 4, "technical", "Fix or redirect broken internal links.", `${brokenLinks.length}/${sample.length} broken`));
  }

  const cats: Check["category"][] = ["seo", "technical", "mobile", "conversion", "social"];
  const categoryScores = Object.fromEntries(cats.map((c) => {
    const list = checks.filter((k) => k.category === c);
    const total = list.reduce((s, k) => s + k.weight, 0) || 1;
    return [c, Math.round((list.filter((k) => k.pass).reduce((s, k) => s + k.weight, 0) / total) * 100)];
  })) as Record<Check["category"], number>;
  const total = checks.reduce((s, k) => s + k.weight, 0);
  const score = Math.round((checks.filter((k) => k.pass).reduce((s, k) => s + k.weight, 0) / total) * 100);

  const services: string[] = [];
  if (score < 55 || !a.viewport || !https) services.push("Website redesign");
  if (categoryScores.seo < 70) services.push("SEO");
  if (categoryScores.social < 60) services.push("Social media management");
  if (!a.hasWhatsApp) services.push("WhatsApp automation");
  if (!a.hasContactForm || !a.hasAnalytics) services.push("Lead capture & Google Ads");

  return {
    url: page.url, finalUrl: page.finalUrl, status: page.status, ms: page.ms, bytes: page.bytes, score, categoryScores,
    title: a.title, metaDescription: a.metaDescription, h1: a.h1, h2Count: a.h2Count, wordCount: a.wordCount,
    images: a.images, imagesMissingAlt: a.imagesMissingAlt, internalLinks: a.internalLinks, externalLinks: a.externalLinks,
    canonical: a.canonical, lang: a.lang, schemaTypes: a.schemaTypes, phones: a.phones, emails: a.emails, social: a.social,
    platform: a.platform, hasWhatsApp: a.hasWhatsApp, hasContactForm: a.hasContactForm, hasMap: a.hasMap, hasBooking: a.hasBooking,
    robotsTxt, sitemap, brokenLinks, checks, services,
  };
}

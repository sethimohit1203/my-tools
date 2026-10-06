"use client";
// Renders an /api/audit result (used by Website Analyzer and Reports).
import { ScoreBadge } from "./ui";

export type Audit = {
  url: string; finalUrl: string; status: number; error?: string; ms: number; bytes: number; score: number;
  categoryScores: Record<string, number>; title: string; metaDescription: string; h1: string[]; h2Count: number; wordCount: number;
  images: number; imagesMissingAlt: number; internalLinks: number; externalLinks: number; canonical: string; lang: string;
  schemaTypes: string[]; phones: string[]; emails: string[]; social: Record<string, string>; platform: string;
  hasWhatsApp: boolean; hasContactForm: boolean; hasMap: boolean; hasBooking: boolean; robotsTxt?: boolean; sitemap?: boolean;
  brokenLinks?: { url: string; status: number }[];
  checks: { id: string; label: string; pass: boolean; weight: number; category: string; tip: string; detail?: string }[];
  services: string[];
};

const CAT_LABEL: Record<string, string> = { seo: "SEO", technical: "Technical & speed", mobile: "Mobile", conversion: "Conversion / UX", social: "Social" };

export function scoreColor(n: number) { return n >= 70 ? "#16a34a" : n >= 45 ? "#d97706" : "#dc2626"; }

export function AuditView({ a }: { a: Audit }) {
  if (a.error && !a.checks?.length) return <div className="tk-banner err">Could not load {a.url}: {a.error}</div>;
  return (
    <div>
      <div className="tk-grid" style={{ ["--min" as string]: "140px", marginBottom: 14 }}>
        <div className="tk-stat" style={{ borderWidth: 2, borderColor: scoreColor(a.score) }}><b style={{ color: scoreColor(a.score), fontSize: 30 }}>{a.score}/100</b><span>Website score</span></div>
        {Object.entries(a.categoryScores).map(([k, v]) => (
          <div key={k} className="tk-stat"><b style={{ color: scoreColor(v) }}>{v}</b><span>{CAT_LABEL[k] || k}</span></div>
        ))}
      </div>
      <div className="tk-grid" style={{ ["--min" as string]: "320px" }}>
        <section className="tk-card">
          <h3>Checks</h3>
          {a.checks.map((c) => (
            <div key={c.id} className="tk-check">
              <span>{c.pass ? "✅" : "❌"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{c.label} {c.detail && <span className="tk-muted">· {c.detail}</span>}</div>
                {!c.pass && <div className="tk-muted">Fix: {c.tip}</div>}
              </div>
              <span className="tk-badge">{CAT_LABEL[c.category]}</span>
            </div>
          ))}
        </section>
        <div>
          <section className="tk-card">
            <h3>Page details</h3>
            <Row k="Final URL" v={<a href={a.finalUrl} target="_blank" rel="noreferrer">{a.finalUrl}</a>} />
            <Row k="Status / time / size" v={`HTTP ${a.status} · ${(a.ms / 1000).toFixed(2)}s · ${Math.round(a.bytes / 1024)} KB`} />
            <Row k="Platform" v={a.platform} />
            <Row k="Title" v={a.title || "—"} />
            <Row k="Meta description" v={a.metaDescription || "—"} />
            <Row k="H1" v={a.h1.join(" | ") || "—"} />
            <Row k="Content" v={`${a.wordCount} words · ${a.h2Count} H2 · ${a.images} images (${a.imagesMissingAlt} without alt)`} />
            <Row k="Links" v={`${a.internalLinks} internal · ${a.externalLinks} external`} />
            <Row k="Schema" v={a.schemaTypes.join(", ") || "none"} />
            {a.robotsTxt != null && <Row k="robots.txt / sitemap" v={`${a.robotsTxt ? "✅" : "❌"} / ${a.sitemap ? "✅" : "❌"}`} />}
            {!!a.brokenLinks?.length && <Row k="Broken links" v={a.brokenLinks.map((b) => `${b.url} (${b.status || "error"})`).join(", ")} />}
          </section>
          <section className="tk-card">
            <h3>Contact & presence</h3>
            <Row k="Phones" v={a.phones.join(", ") || "—"} />
            <Row k="Emails" v={a.emails.join(", ") || "—"} />
            <Row k="WhatsApp / Form / Map / Booking" v={`${a.hasWhatsApp ? "✅" : "❌"} / ${a.hasContactForm ? "✅" : "❌"} / ${a.hasMap ? "✅" : "❌"} / ${a.hasBooking ? "✅" : "❌"}`} />
            <Row k="Social" v={Object.keys(a.social).length ? Object.entries(a.social).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{k}</a>) : "none found"} />
          </section>
          <section className="tk-card">
            <h3>Recommended services</h3>
            {a.services.length ? a.services.map((s) => <span key={s} className="tk-badge accent" style={{ marginRight: 6 }}>{s}</span>) : <span className="tk-muted">Site is in good shape.</span>}
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, fontSize: 12.5, padding: "5px 0", borderBottom: "1px dashed var(--border)" }}><span className="tk-muted">{k}</span><span style={{ wordBreak: "break-word" }}>{v}</span></div>;
}

export { ScoreBadge };

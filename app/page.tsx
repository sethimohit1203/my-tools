"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useStored } from "./lib/store";
import { inr, LEADS_KEY, type Lead } from "./lib/leads";

type Tool = { name: string; desc: string; url: string; icon: string; color: string; tag?: string; for?: string };

const SECTIONS: { title: string; sub: string; tools: Tool[] }[] = [
  {
    title: "🚀 Business Growth OS",
    sub: "Discover → Analyze → Score → Sell → Follow-up → Convert",
    tools: [
      { name: "Lead Finder & Scorer", desc: "Find businesses on OpenStreetMap (free) or Google Places, audit their websites, score leads HOT/WARM/COLD and see the opportunities. Presets for Designoia, COL, ClikiXpress and InnBly.", url: "/gmaps", icon: "🗺️", color: "#0ea5e9", for: "Designoia · COL · ClikiXpress · InnBly" },
      { name: "Lead CRM & Follow-ups", desc: "Pipeline from New → Won, follow-up dates, notes, deal value, AI lead analysis, WhatsApp/email outreach and Google Sheets sync.", url: "/crm", icon: "📇", color: "#6366f1", for: "Designoia" },
      { name: "Local SEO & Competitor Analyzer", desc: "Market overview for any keyword + city: top competitors, average rating/reviews, website gaps and an AI plan to beat them.", url: "/local-seo", icon: "📍", color: "#f97316", for: "ProRido · clients · InnBly" },
      { name: "Proposal Generator", desc: "Turn lead/audit data into a branded client proposal with problems found, services and pricing. Print to PDF or send.", url: "/proposal", icon: "📄", color: "#8b5cf6", for: "Designoia" },
    ],
  },
  {
    title: "🔎 SEO & Content Tools",
    sub: "Audit, research, plan and publish",
    tools: [
      { name: "Website Analyzer", desc: "Speed, HTTPS, mobile, SEO tags, schema, broken links, WhatsApp/forms/social — scored /100 with fixes and an AI summary.", url: "/seo-audit", icon: "🩺", color: "#f59e0b", for: "Designoia" },
      { name: "Keyword Researcher", desc: "Hundreds of real Google autocomplete keywords from one seed, with intent, long-tail and topic clusters. Export CSV.", url: "/keywords", icon: "🔑", color: "#10b981", for: "Designoia · ProRido" },
      { name: "Content Planner", desc: "AI monthly content calendar for blogs and social, by business and audience.", url: "/content-planner", icon: "🗓️", color: "#ec4899", for: "Designoia · COL" },
      { name: "Blog Generator", desc: "Generate a full SEO blog post (outline, meta, FAQ, schema) and publish straight to WordPress.", url: "/blog-gen", icon: "✍️", color: "#db2777" },
      { name: "Internal Link Builder", desc: "Crawls your sitemap and finds pages that mention another page's topic without linking to it, plus orphan pages.", url: "/internal-links", icon: "🔗", color: "#14b8a6", for: "ProRido" },
      { name: "Schema Generator", desc: "JSON-LD for LocalBusiness, Organization, Article, FAQ, Product, Breadcrumb, Event, Course and more.", url: "/schema", icon: "🧩", color: "#64748b", for: "ProRido" },
      { name: "Image SEO Tool", desc: "Convert to WebP, compress, resize, SEO filenames and AI alt/title text — all in your browser.", url: "/image-seo", icon: "🖼️", color: "#0891b2" },
      { name: "WordPress AI Tool", desc: "Manage any WordPress site in plain English — posts, meta, Rank Math SEO — via Claude, GPT-4o, Gemini or Groq.", url: "/wp-api", icon: "🤖", color: "#6366f1" },
      { name: "Backlink Tracker", desc: "Track and manage your backlink submissions across 500+ sites.", url: "/backlinks", icon: "🧷", color: "#10b981" },
    ],
  },
  {
    title: "⚡ Automation",
    sub: "Workflows, bulk AI, outreach, publishing, monitoring and reports",
    tools: [
      { name: "Workflow Builder", desc: "Trigger → Action → Condition → Action, like a lightweight n8n. AI, HTTP, Sheets, WordPress, WhatsApp, Email steps. Webhook + daily schedule triggers.", url: "/automation", icon: "🔄", color: "#7c3aed" },
      { name: "Google Sheets Automation", desc: "Read a sheet → AI processes each row → write results back. COL results, Designoia leads, ClikiXpress products.", url: "/sheets-automation", icon: "📋", color: "#16a34a" },
      { name: "AI Auto-Processor", desc: "Upload a CSV (e.g. 500 businesses) → AI fills new columns for every row (category, lead score, service…) → download.", url: "/ai-processor", icon: "🧠", color: "#2563eb" },
      { name: "Email Automation", desc: "Personalized emails from lead data, follow-up sequences after X days and status tracking.", url: "/outreach?ch=email", icon: "📧", color: "#ea580c" },
      { name: "WhatsApp Automation", desc: "Personalized WhatsApp messages via the official Cloud API (or one-click wa.me), follow-up sequences, status tracking.", url: "/outreach?ch=whatsapp", icon: "💬", color: "#22c55e" },
      { name: "Social Media Automation", desc: "Content calendar → AI captions & hashtags → publish via webhook (n8n/Make/Buffer) → track status.", url: "/social", icon: "📱", color: "#e11d48" },
      { name: "WordPress Automation", desc: "Bulk create/update posts, meta, schema, featured images and scheduled publishing.", url: "/wp-automation", icon: "🌐", color: "#3b82f6" },
      { name: "Website / SEO Monitor", desc: "Watch your and competitors' sites: downtime, title/meta/H1 changes, content changes, new sitemap pages.", url: "/monitor", icon: "🔔", color: "#dc2626" },
      { name: "Report Automation", desc: "Website data → AI analysis → client-ready PDF report → email it. Perfect for monthly SEO reports.", url: "/reports", icon: "📊", color: "#9333ea" },
      { name: "Webhook / API Automation", desc: "Every deployed workflow gets a webhook URL so your other apps (n8n, forms, CRMs) can trigger it.", url: "/automation?tab=webhooks", icon: "🪝", color: "#475569" },
    ],
  },
];

export default function Home() {
  const [leads] = useStored<Lead[]>(LEADS_KEY, []);
  const [theme] = useStored<"light" | "dark">("tools-theme", "light");
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const today = new Date().toISOString().slice(0, 10);
  const stats = [
    { v: leads.length, l: "Businesses in CRM" },
    { v: leads.filter((l) => l.temperature === "HOT").length, l: "Hot leads" },
    { v: leads.filter((l) => ["Proposal Sent", "Negotiation"].includes(l.stage)).length, l: "Proposals" },
    { v: leads.filter((l) => !l.website).length, l: "No website" },
    { v: leads.filter((l) => l.followUp && l.followUp <= today && !["Won", "Lost"].includes(l.stage)).length, l: "Follow-ups due" },
    { v: inr(leads.filter((l) => !["Lost"].includes(l.stage)).reduce((s, l) => s + (l.value || 0), 0)), l: "Pipeline" },
  ];

  return (
    <main className="tk">
      <div className="tk-wrap">
        <div className="tk-head" style={{ marginBottom: 6 }}>
          <h1 style={{ fontSize: 32 }}>My Tools</h1>
          <Link href="/settings" className="tk-btn">⚙ Settings & API keys</Link>
        </div>
        <p className="tk-muted" style={{ fontSize: 15, marginBottom: 22 }}>AI-powered tools for SEO, WordPress, lead generation and automation — for COL, Designoia, ClikiXpress, InnBly & ProRido.</p>

        <div className="tk-grid" style={{ ["--min" as string]: "150px", marginBottom: 30 }}>
          {stats.map((s) => (
            <Link key={s.l} href="/crm" className="tk-stat" style={{ textDecoration: "none", color: "inherit" }}><b>{s.v}</b><span>{s.l}</span></Link>
          ))}
        </div>

        {SECTIONS.map((sec) => (
          <section key={sec.title} style={{ marginBottom: 34 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 2px" }}>{sec.title}</h2>
            <p className="tk-muted" style={{ marginBottom: 14 }}>{sec.sub}</p>
            <div className="tk-grid" style={{ ["--min" as string]: "300px", gap: 16 }}>
              {sec.tools.map((t) => <ToolCard key={t.url} tool={t} />)}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Link href={tool.url} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="tk-card tool-card" style={{ height: "100%", marginBottom: 0, padding: 20, cursor: "pointer", transition: "box-shadow .15s" }}
        onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, background: tool.color + "1c", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21 }}>{tool.icon}</div>
          <span className="tk-badge green">{tool.tag || "Live"}</span>
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 650, margin: "0 0 6px" }}>{tool.name}</h3>
        <p style={{ fontSize: 13, color: "var(--sub)", lineHeight: 1.6, margin: 0 }}>{tool.desc}</p>
        {tool.for && <div className="tk-muted" style={{ marginTop: 10, fontSize: 11, fontWeight: 600 }}>Best for: {tool.for}</div>}
      </div>
    </Link>
  );
}

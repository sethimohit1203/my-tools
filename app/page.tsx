"use client";
import Link from "next/link";

const tools = [
  {
    name: "WordPress AI Tool",
    desc: "Manage any WordPress site using natural language. Update posts, meta, Rank Math SEO — via Claude, GPT-4o or Gemini.",
    url: "/wp-api",
    icon: "🤖",
    color: "#6366f1",
    tag: "Live",
  },
  {
    name: "Backlink Tracker",
    desc: "Track and manage your backlink submissions across 500+ sites.",
    url: "/backlinks",
    icon: "🔗",
    color: "#10b981",
    tag: "Coming soon",
  },
  {
    name: "SEO Audit",
    desc: "Audit any page for on-page SEO issues, missing meta, thin content.",
    url: "/seo-audit",
    icon: "📊",
    color: "#f59e0b",
    tag: "Coming soon",
  },
  {
    name: "Blog Generator",
    desc: "Generate full SEO-optimized blog posts and publish directly to WordPress.",
    url: "/blog-gen",
    icon: "✍️",
    color: "#ec4899",
    tag: "Coming soon",
  },
];

export default function Home() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ marginBottom: 48 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>
          My Tools
        </h1>
        <p style={{ fontSize: 16, color: "#6b7280" }}>
          AI-powered tools for SEO, WordPress, and content — built for speed.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: 20,
        }}
      >
        {tools.map((tool) => (
          <ToolCard key={tool.url} tool={tool} />
        ))}
      </div>
    </main>
  );
}

function ToolCard({ tool }: { tool: (typeof tools)[0] }) {
  return (
    <Link href={tool.url} style={{ textDecoration: "none" }}>
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: "24px",
          cursor: "pointer",
          height: "100%",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: tool.color + "18",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
            }}
          >
            {tool.icon}
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 20,
              background: tool.tag === "Live" ? "#dcfce7" : "#f3f4f6",
              color: tool.tag === "Live" ? "#16a34a" : "#6b7280",
            }}
          >
            {tool.tag}
          </span>
        </div>
        <h2
          style={{ fontSize: 17, fontWeight: 600, marginBottom: 6, color: "#111" }}
        >
          {tool.name}
        </h2>
        <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>
          {tool.desc}
        </p>
      </div>
    </Link>
  );
}
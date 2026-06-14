"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  action?: WPAction;
  actionState?: "pending" | "confirmed" | "cancelled" | "done" | "error";
  actionResult?: string;
};

type WPAction = {
  action: "read" | "write";
  method: string;
  endpoint: string;
  payload?: Record<string, unknown>;
  queryParams?: Record<string, string>;
  description: string;
};

type Model = "claude" | "gpt" | "gemini" | "groq";

type Config = {
  wpUrl: string;
  wpUser: string;
  wpPass: string;
  claudeKey: string;
  oaiKey: string;
  gemKey: string;
  groqKey: string;
  model: Model;
};

type SavedSite = {
  name: string;
  wpUrl: string;
  wpUser: string;
  wpPass: string;
};

const defaultConfig: Config = {
  wpUrl: "", wpUser: "", wpPass: "",
  claudeKey: "", oaiKey: "", gemKey: "", groqKey: "",
  model: "groq",
};

function getSavedSites(): SavedSite[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("wp-ai-sites") || "[]"); }
  catch { return []; }
}

function saveSiteToStorage(site: SavedSite) {
  const sites = getSavedSites();
  const existing = sites.findIndex((s) => s.wpUrl === site.wpUrl);
  if (existing >= 0) sites[existing] = site;
  else sites.push(site);
  localStorage.setItem("wp-ai-sites", JSON.stringify(sites));
}

const SYSTEM_PROMPT = `You are a WordPress REST API assistant. Convert natural language commands into WP REST API calls.

Always respond with ONLY:
1. One brief sentence explanation
2. The JSON block below

\`\`\`json
{
  "action": "read",
  "method": "GET",
  "endpoint": "/wp-json/wp/v2/posts",
  "queryParams": { "per_page": "20", "_fields": "id,title,status,link" },
  "payload": {},
  "description": "Fetch posts"
}
\`\`\`

ENDPOINT REFERENCE — use exactly these:
- Posts: GET /wp-json/wp/v2/posts?per_page=20&_fields=id,title,status,link
- Pages: GET /wp-json/wp/v2/pages?per_page=20&_fields=id,title,status,link
- Drafts: GET /wp-json/wp/v2/posts?status=draft&per_page=50&_fields=id,title,status
- Categories: GET /wp-json/wp/v2/categories?per_page=50&_fields=id,name,count,link
- Tags: GET /wp-json/wp/v2/tags?per_page=50&_fields=id,name,count
- Search posts: GET /wp-json/wp/v2/posts?search=TERM&_fields=id,title,status,link
- Custom post type: GET /wp-json/wp/v2/{post-type}?per_page=50&_fields=id,title,status,link
- Update post title: PUT /wp-json/wp/v2/posts/{id} payload: {"title":"new title"}
- Update page: PUT /wp-json/wp/v2/pages/{id} with payload
- Publish draft: PUT /wp-json/wp/v2/posts/{id} payload: {"status":"publish"}
- Rank Math focus keyword: PUT /wp-json/wp/v2/posts/{id} payload: {"meta":{"rank_math_focus_keyword":"keyword"}}
- Rank Math meta desc: PUT /wp-json/wp/v2/posts/{id} payload: {"meta":{"rank_math_description":"desc"}}
- Rank Math title: PUT /wp-json/wp/v2/posts/{id} payload: {"meta":{"rank_math_title":"title"}}
- WooCommerce Products: GET /wp-json/wc/v3/products?per_page=50

RULES:
- action = "read" for GET (auto-executes)
- action = "write" for POST/PUT/DELETE (needs confirmation)
- Always include _fields in GET requests
- NEVER add extra text after the JSON block
- If command is unclear, ask for clarification`;

const MODEL_CONFIG = {
  claude: { label: "Claude",    color: "#6366f1", free: false },
  gpt:    { label: "GPT-4o",   color: "#10a37f", free: false },
  gemini: { label: "Gemini",   color: "#4285f4", free: true  },
  groq:   { label: "Groq",     color: "#f55036", free: true  },
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px",
  border: "1px solid #e5e7eb", borderRadius: 8,
  fontSize: 13, fontFamily: "inherit",
  background: "#fff", color: "#111",
};

export default function WpApiPage() {
  const [config, setConfig] = useState<Config>(() => {
    if (typeof window === "undefined") return defaultConfig;
    try {
      const saved = localStorage.getItem("wp-ai-config");
      return saved ? { ...defaultConfig, ...JSON.parse(saved) } : defaultConfig;
    } catch { return defaultConfig; }
  });

  const [connected, setConnected] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const saved = localStorage.getItem("wp-ai-config");
      if (!saved) return false;
      const c = JSON.parse(saved);
      return !!(c.wpUrl && c.wpUser && c.wpPass);
    } catch { return false; }
  });

  const [savedSites, setSavedSites] = useState<SavedSite[]>(() => getSavedSites());
  const [showSitePicker, setShowSitePicker] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [msgCounter, setMsgCounter] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("wp-ai-config", JSON.stringify(config));
    }
  }, [config]);

  const addMessage = (msg: Omit<Message, "id">): number => {
    const id = msgCounter + 1;
    setMsgCounter((c) => c + 1);
    setMessages((prev) => [...prev, { ...msg, id }]);
    return id;
  };

  const updateMessage = (id: number, updates: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  };

  function parseAction(text: string): WPAction | null {
    const match = text.match(/```json\s*([\s\S]*?)```/);
    if (!match) return null;
    try { return JSON.parse(match[1]); } catch { return null; }
  }

  function getNarrative(text: string): string {
    return text.replace(/```json[\s\S]*?```/g, "").trim();
  }

  async function callAI(userMsg: string): Promise<string> {
    if (config.model === "groq") {
      if (!config.groqKey) throw new Error("Groq API key not set. Click ⚙ Settings and add your free key from console.groq.com");
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + config.groqKey },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile", max_tokens: 1000,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userMsg }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.choices?.[0]?.message?.content || "No response.";
    }

    if (config.model === "claude") {
      if (!config.claudeKey) throw new Error("Claude API key not set. Click ⚙ Settings and add your key from console.anthropic.com");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": config.claudeKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.content?.[0]?.text || "No response.";
    }

    if (config.model === "gpt") {
      if (!config.oaiKey) throw new Error("OpenAI API key not set. Click ⚙ Settings and add your key from platform.openai.com");
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + config.oaiKey },
        body: JSON.stringify({
          model: "gpt-4o", max_tokens: 1000,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userMsg }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.choices?.[0]?.message?.content || "No response.";
    }

    if (config.model === "gemini") {
      if (!config.gemKey) throw new Error("Gemini API key not set. Click ⚙ Settings and add your key from aistudio.google.com");
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.gemKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ parts: [{ text: userMsg }] }],
          }),
        }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
    }

    throw new Error("Unknown model selected");
  }

  async function executeWP(action: WPAction) {
    const auth = btoa(config.wpUser + ":" + config.wpPass);
    let url = config.wpUrl.replace(/\/$/, "") + action.endpoint;
    if (action.queryParams && Object.keys(action.queryParams).length > 0) {
      url += "?" + new URLSearchParams(action.queryParams).toString();
    }
    const opts: RequestInit = {
      method: action.method,
      headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" },
    };
    if (action.payload && Object.keys(action.payload).length > 0 && action.method !== "GET") {
      opts.body = JSON.stringify(action.payload);
    }
    const res = await fetch(url, opts);
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  }

  function formatResult(data: unknown): string {
    if (Array.isArray(data)) {
      if (data.length === 0) return "No results found.";
      return (data as Record<string, unknown>[])
        .map((p) => {
          const title = (p.title as { rendered?: string })?.rendered || String(p.name || p.title || "(no title)");
          const status = p.status ? ` [${p.status}]` : "";
          const link = p.link || p.permalink || "";
          const price = p.price ? ` — ₹${p.price}` : "";
          return `#${p.id} — ${title}${status}${price}${link ? "\n   " + link : ""}`;
        }).join("\n\n");
    }
    const d = data as Record<string, unknown>;
    const title = (d.title as { rendered?: string })?.rendered || String(d.name || d.title || "");
    return `✅ Done${title ? ": " + title : ""}${d.link ? "\n🔗 " + d.link : ""}`;
  }

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput("");
    setLoading(true);
    addMessage({ role: "user", text: userText });

    try {
      const aiText = await callAI(userText);
      const narrative = getNarrative(aiText);
      const action = parseAction(aiText);

      if (!action) {
        addMessage({ role: "assistant", text: narrative || aiText });
      } else if (action.action === "read") {
        const msgId = addMessage({ role: "assistant", text: narrative || "Fetching…", action, actionState: "confirmed" });
        try {
          const result = await executeWP(action);
          updateMessage(msgId, {
            actionState: result.ok ? "done" : "error",
            actionResult: result.ok
              ? formatResult(result.data)
              : `Error ${result.status}: ${(result.data as { message?: string })?.message || "Check your WP credentials"}`,
          });
        } catch (e) {
          updateMessage(msgId, { actionState: "error", actionResult: String(e) });
        }
      } else {
        addMessage({ role: "assistant", text: narrative || "Ready to make this change.", action, actionState: "pending" });
      }
    } catch (e) {
      addMessage({ role: "assistant", text: `❌ ${String(e)}` });
    }
    setLoading(false);
  }

  async function confirmAction(msgId: number, action: WPAction) {
    updateMessage(msgId, { actionState: "confirmed" });
    try {
      const result = await executeWP(action);
      updateMessage(msgId, {
        actionState: result.ok ? "done" : "error",
        actionResult: result.ok
          ? formatResult(result.data)
          : `Error ${result.status}: ${(result.data as { message?: string })?.message || "Something went wrong"}`,
      });
    } catch (e) {
      updateMessage(msgId, { actionState: "error", actionResult: String(e) });
    }
  }

  const quickPrompts = [
    "List recent 20 posts with IDs",
    "Show all draft posts",
    "List pages on the site",
    "Show posts missing meta description",
    "List all categories",
  ];

  const domainLabel = config.wpUrl.replace(/https?:\/\//, "").split("/")[0] || "No site";

  // ── CONNECT SCREEN ──────────────────────────────────────────────
  if (!connected) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
        <Link href="/" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none", display: "flex", alignItems: "center", gap: 4, marginBottom: 32 }}>
          ← Back to dashboard
        </Link>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>WordPress AI Tool</h1>
        <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>Connect your site and manage it using natural language.</p>

        {/* Saved sites quick connect */}
        {savedSites.length > 0 && (
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#166534", marginBottom: 10 }}>⚡ Quick connect — saved sites</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {savedSites.map((site) => (
                <button key={site.wpUrl}
                  onClick={() => {
                    setConfig((c) => ({ ...c, wpUrl: site.wpUrl, wpUser: site.wpUser, wpPass: site.wpPass }));
                    setConnected(true);
                  }}
                  style={{ padding: "8px 14px", background: "#fff", border: "1px solid #86efac", borderRadius: 8, fontSize: 13, cursor: "pointer", textAlign: "left", color: "#111", fontWeight: 500 }}>
                  {site.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: "#374151" }}>
            {savedSites.length > 0 ? "Connect a new site" : "WordPress Connection"}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Site URL</label>
              <input style={inputStyle} placeholder="https://yoursite.com" value={config.wpUrl}
                onChange={(e) => setConfig((c) => ({ ...c, wpUrl: e.target.value }))} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Username</label>
                <input style={inputStyle} placeholder="admin" value={config.wpUser}
                  onChange={(e) => setConfig((c) => ({ ...c, wpUser: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Application Password</label>
                <input style={inputStyle} type="password" placeholder="xxxx xxxx xxxx xxxx"
                  value={config.wpPass} onChange={(e) => setConfig((c) => ({ ...c, wpPass: e.target.value }))} />
              </div>
            </div>
            <p style={{ fontSize: 11, color: "#9ca3af" }}>WP Admin → Users → Your Profile → scroll to Application Passwords → Add New</p>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#374151" }}>AI API Keys</h2>
          <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>
            <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: 4, fontWeight: 600, fontSize: 11 }}>FREE</span>
            {" "}Groq is free — get key at console.groq.com. Gemini free tier resets daily.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Groq Key <span style={{ color: "#16a34a", fontWeight: 600 }}>(free)</span></label>
              <input style={inputStyle} type="password" placeholder="gsk_..." value={config.groqKey}
                onChange={(e) => setConfig((c) => ({ ...c, groqKey: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Gemini Key <span style={{ color: "#16a34a", fontWeight: 600 }}>(free tier)</span></label>
              <input style={inputStyle} type="password" placeholder="AIza..." value={config.gemKey}
                onChange={(e) => setConfig((c) => ({ ...c, gemKey: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Anthropic Key (Claude)</label>
              <input style={inputStyle} type="password" placeholder="sk-ant-..." value={config.claudeKey}
                onChange={(e) => setConfig((c) => ({ ...c, claudeKey: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>OpenAI Key (GPT-4o)</label>
              <input style={inputStyle} type="password" placeholder="sk-..." value={config.oaiKey}
                onChange={(e) => setConfig((c) => ({ ...c, oaiKey: e.target.value }))} />
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            if (!config.wpUrl || !config.wpUser || !config.wpPass) {
              alert("Please fill in WordPress URL, username and application password.");
              return;
            }
            const site: SavedSite = {
              name: config.wpUrl.replace(/https?:\/\//, "").split("/")[0],
              wpUrl: config.wpUrl, wpUser: config.wpUser, wpPass: config.wpPass,
            };
            saveSiteToStorage(site);
            setSavedSites(getSavedSites());
            setConnected(true);
          }}
          style={{ width: "100%", padding: "12px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          Connect & Open Tool →
        </button>
      </main>
    );
  }

  // ── MAIN TOOL SCREEN ────────────────────────────────────────────
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Link href="/" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>← Back</Link>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>WordPress AI Tool</h1>

          {/* Site switcher dropdown */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowSitePicker((s) => !s)}
              style={{ fontSize: 11, padding: "3px 10px", background: "#dcfce7", color: "#16a34a", border: "1px solid #86efac", borderRadius: 20, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              {domainLabel} ▾
            </button>
            {showSitePicker && (
              <div style={{ position: "absolute", top: "110%", left: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 8, zIndex: 100, minWidth: 200, boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}>
                <div style={{ fontSize: 11, color: "#9ca3af", padding: "4px 8px", marginBottom: 4 }}>Saved sites</div>
                {savedSites.map((site) => (
                  <button key={site.wpUrl}
                    onClick={() => {
                      setConfig((c) => ({ ...c, wpUrl: site.wpUrl, wpUser: site.wpUser, wpPass: site.wpPass }));
                      setMessages([]);
                      setShowSitePicker(false);
                    }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", background: site.wpUrl === config.wpUrl ? "#f0fdf4" : "transparent", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer", color: "#111" }}>
                    {site.name} {site.wpUrl === config.wpUrl && <span style={{ color: "#16a34a" }}>✓</span>}
                  </button>
                ))}
                <div style={{ borderTop: "1px solid #f3f4f6", marginTop: 6, paddingTop: 6 }}>
                  <button
                    onClick={() => { setConnected(false); setShowSitePicker(false); setMessages([]); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", background: "transparent", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer", color: "#6366f1", fontWeight: 500 }}>
                    + Add new site
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <button onClick={() => setShowSettings((s) => !s)}
          style={{ fontSize: 12, padding: "6px 14px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: "pointer", color: "#374151" }}>
          ⚙ Settings
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>WordPress Connection</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>URL</label>
              <input style={inputStyle} value={config.wpUrl} onChange={(e) => setConfig((c) => ({ ...c, wpUrl: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>Username</label>
              <input style={inputStyle} value={config.wpUser} onChange={(e) => setConfig((c) => ({ ...c, wpUser: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>App Password</label>
              <input style={inputStyle} type="password" value={config.wpPass} onChange={(e) => setConfig((c) => ({ ...c, wpPass: e.target.value }))} />
            </div>
          </div>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>AI API Keys</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>Groq (free) — console.groq.com</label>
              <input style={inputStyle} type="password" placeholder="gsk_..." value={config.groqKey} onChange={(e) => setConfig((c) => ({ ...c, groqKey: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>Gemini (free tier)</label>
              <input style={inputStyle} type="password" placeholder="AIza..." value={config.gemKey} onChange={(e) => setConfig((c) => ({ ...c, gemKey: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>Anthropic (Claude)</label>
              <input style={inputStyle} type="password" placeholder="sk-ant-..." value={config.claudeKey} onChange={(e) => setConfig((c) => ({ ...c, claudeKey: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>OpenAI (GPT-4o)</label>
              <input style={inputStyle} type="password" placeholder="sk-..." value={config.oaiKey} onChange={(e) => setConfig((c) => ({ ...c, oaiKey: e.target.value }))} />
            </div>
          </div>
          <button onClick={() => {
            const site: SavedSite = { name: domainLabel, wpUrl: config.wpUrl, wpUser: config.wpUser, wpPass: config.wpPass };
            saveSiteToStorage(site);
            setSavedSites(getSavedSites());
            setShowSettings(false);
          }}
            style={{ marginTop: 14, fontSize: 12, padding: "6px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
            Save & Close
          </button>
        </div>
      )}

      {/* Model tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {(Object.keys(MODEL_CONFIG) as Model[]).map((m) => {
          const mc = MODEL_CONFIG[m];
          const active = config.model === m;
          return (
            <button key={m} onClick={() => setConfig((c) => ({ ...c, model: m }))}
              style={{ padding: "7px 16px", borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: "pointer", border: active ? `2px solid ${mc.color}` : "1px solid #e5e7eb", background: active ? mc.color + "15" : "#fff", color: active ? mc.color : "#6b7280", display: "flex", alignItems: "center", gap: 6 }}>
              {mc.label}
              {mc.free && <span style={{ fontSize: 10, background: "#dcfce7", color: "#16a34a", padding: "1px 5px", borderRadius: 4, fontWeight: 700 }}>FREE</span>}
            </button>
          );
        })}
      </div>

      {/* Quick prompts */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {quickPrompts.map((p) => (
          <button key={p} onClick={() => setInput(p)}
            style={{ fontSize: 11, padding: "5px 12px", border: "1px solid #e5e7eb", borderRadius: 20, background: "#fff", cursor: "pointer", color: "#374151" }}>
            {p}
          </button>
        ))}
      </div>

      {/* Chat area */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", minHeight: 380, maxHeight: 500 }}>
          {messages.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 14, gap: 8, padding: "80px 0", textAlign: "center" }}>
              <span style={{ fontSize: 36 }}>🤖</span>
              <span>Connected to {domainLabel}</span>
              <span style={{ fontSize: 12 }}>Type a command or click a quick prompt above</span>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: 8 }}>
              <div style={{ padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.6, maxWidth: "88%", background: msg.role === "user" ? MODEL_CONFIG[config.model].color : "#f9fafb", color: msg.role === "user" ? "#fff" : "#111", border: msg.role === "assistant" ? "1px solid #e5e7eb" : "none", borderBottomRightRadius: msg.role === "user" ? 4 : 12, borderBottomLeftRadius: msg.role === "assistant" ? 4 : 12, whiteSpace: "pre-wrap" }}>
                {msg.text}
              </div>

              {msg.action && msg.actionState === "pending" && (
                <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "12px 14px", maxWidth: "88%", fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: "#92400e", marginBottom: 8 }}>⚠ Review before executing</div>
                  <pre style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: 10, fontSize: 11, overflowX: "auto", marginBottom: 10, color: "#374151", whiteSpace: "pre-wrap" }}>
{JSON.stringify({ method: msg.action.method, endpoint: msg.action.endpoint, payload: msg.action.payload }, null, 2)}
                  </pre>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => confirmAction(msg.id, msg.action!)}
                      style={{ padding: "6px 16px", background: "#dcfce7", color: "#16a34a", border: "1px solid #86efac", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      ✓ Confirm
                    </button>
                    <button onClick={() => updateMessage(msg.id, { actionState: "cancelled" })}
                      style={{ padding: "6px 16px", background: "#f9fafb", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                      ✕ Cancel
                    </button>
                  </div>
                </div>
              )}

              {msg.actionState === "confirmed" && !msg.actionResult && msg.action?.action === "write" && (
                <div style={{ fontSize: 12, color: "#6b7280", padding: "4px 14px" }}>Executing…</div>
              )}

              {msg.actionResult && (
                <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 12, maxWidth: "88%", whiteSpace: "pre-wrap", fontFamily: "monospace", background: msg.actionState === "done" ? "#f0fdf4" : "#fef2f2", border: `1px solid ${msg.actionState === "done" ? "#86efac" : "#fca5a5"}`, color: msg.actionState === "done" ? "#166534" : "#991b1b" }}>
                  {msg.actionResult}
                </div>
              )}

              {msg.actionState === "cancelled" && (
                <div style={{ fontSize: 12, color: "#9ca3af", padding: "2px 14px" }}>Cancelled — no changes made.</div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ display: "flex" }}>
              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, borderBottomLeftRadius: 4, padding: "12px 16px", display: "flex", gap: 5 }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#9ca3af", display: "inline-block", animation: "blink 1.2s infinite", animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div style={{ borderTop: "1px solid #e5e7eb", padding: 12, display: "flex", gap: 8, background: "#f9fafb", borderRadius: "0 0 12px 12px" }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder='e.g. "List all published posts" or "Update title of post 45" or "Set focus keyword of post 88 to luxury cab delhi"'
            style={{ flex: 1, resize: "none", height: 64, padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff", color: "#111" }} />
          <button onClick={handleSend} disabled={loading || !input.trim()}
            style={{ padding: "0 24px", background: MODEL_CONFIG[config.model].color, color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: loading || !input.trim() ? 0.5 : 1 }}>
            Send
          </button>
        </div>
      </div>

      <style>{`@keyframes blink { 0%,80%,100%{opacity:0.2} 40%{opacity:1} }`}</style>
    </main>
  );
}
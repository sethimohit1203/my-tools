// Local stand-ins for external providers, used ONLY by the e2e tests.
// Production code reaches them through EXTERNAL_API_OVERRIDE (https hosts are
// rewritten to http://127.0.0.1:<port>/<host>/<path>) or plain http URLs.
import http from "node:http";
import { createHmac } from "node:crypto";

export type Call = { host: string; path: string; method: string; body: unknown; headers: http.IncomingHttpHeaders };

export const state = {
  calls: [] as Call[],
  flaky: new Map<string, number>(),
  siteTitle: "ABC Cafe — Best Coffee",
  siteDown: false,
  siteSitemap: ["/", "/menu"],
  sheet: [["Name", "Category", "Phone"], ["Brew Bros", "cafe", "9876543210"]] as string[][],
  wpPosts: [] as { id: number; title: string; status: string; link: string }[],
  n8nWorkflows: [] as { id: string; name: string; active: boolean; nodes: unknown[]; connections: unknown }[],
  appUrl: "",
  engineSecret: "",
  simRuns: new Set<string>(),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function aiReply(prompt: string, wantJson: boolean): string {
  if (prompt.includes("BAD_AI")) return "sorry, I can't produce JSON";
  if (!wantJson) return prompt.includes("Reply with exactly: OK") ? "OK" : `Generated text for: ${prompt.slice(0, 60)}`;
  const m = prompt.match(/exactly these fields: \{([^}]*)\}/);
  const out: Record<string, unknown> = {};
  if (m) for (const part of m[1].split(/,\s*(?=")/)) {
    const mm = part.match(/"([^"]+)":\s*(.*)$/);
    if (!mm) continue;
    const [, name, type] = mm;
    if (type.startsWith("one of")) out[name] = JSON.parse(type.replace("one of ", "").split("|")[0]);
    else if (type.trim() === "number") out[name] = name === "total_marks" ? 40 : 82;
    else if (type.trim() === "boolean") out[name] = true;
    else if (type.trim() === "array") out[name] = ["Improve page speed", "Add WhatsApp button", "Write more service content"];
    else out[name] = `AI ${name.replace(/_/g, " ")} based on supplied data`;
  }
  return JSON.stringify(out);
}

async function readBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return { raw, json: raw ? JSON.parse(raw) : null }; } catch { return { raw, json: null }; }
}

/** Mirrors the generated n8n "Run Processor": step → (done|paused stop) | (wait → sleep) → step. */
async function simulateProcessor(runId: string) {
  state.simRuns.add(runId);
  try {
    for (let i = 0; i < 2000; i++) {
      const r = await fetch(`${state.appUrl}/api/engine/step`, { method: "POST", headers: { "Content-Type": "application/json", "x-engine-secret": state.engineSecret }, body: JSON.stringify({ run_id: runId }) });
      const d = (await r.json()) as { action?: string; wait_seconds?: number; error?: string };
      if (!r.ok) { await sleep(500); continue; } // n8n node retryOnFail
      if (d.action === "done" || d.action === "paused") return;
      if (d.action === "wait") await sleep(Math.min(d.wait_seconds || 1, 2) * 1000);
    }
  } finally { state.simRuns.delete(runId); }
}

export function startMocks(port: number) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const [, host, ...rest] = url.pathname.split("/");
    const path = "/" + rest.join("/");
    const { raw, json } = await readBody(req);
    state.calls.push({ host, path: path + url.search, method: req.method || "GET", body: json ?? raw, headers: req.headers });
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/html" : "application/json", ...headers }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };

    // ── AI (Groq-compatible) ──
    if (host === "api.groq.com") {
      const msgs = (json as { messages: { content: string }[]; response_format?: unknown }).messages;
      const prompt = msgs.map((m) => m.content).join("\n");
      return send(200, { choices: [{ message: { content: aiReply(prompt, !!(json as { response_format?: unknown }).response_format) } }], usage: { prompt_tokens: 120, completion_tokens: 40 } });
    }
    // ── WhatsApp / Meta Graph ──
    if (host === "graph.facebook.com") {
      if (path.endsWith("/messages")) {
        const to = String((json as { to: string }).to);
        if (to.endsWith("0000")) return send(400, { error: { message: "Recipient phone number not in allowed list", code: 131026 } });
        if (to.endsWith("4290")) return send(429, { error: { message: "Rate limit hit", code: 130429 } });
        return send(200, { messaging_product: "whatsapp", messages: [{ id: `wamid.${to}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}` }] });
      }
      if (path.includes("message_templates")) return send(200, { data: [{ name: "lead_intro", status: "APPROVED", language: "en", category: "MARKETING", components: [{ type: "BODY", text: "Hi {{1}}, we help with {{2}}" }] }] });
      if (path.includes("/feed") || path.includes("/photos")) return send(200, { id: "123_456" });
      return send(200, { display_phone_number: "+91 99999 00000", verified_name: "Designoia", quality_rating: "GREEN", name: "Designoia Page" });
    }
    // ── Resend ──
    if (host === "api.resend.com") {
      if (path === "/emails") { const to = JSON.stringify((json as { to: string[] }).to); if (to.includes("reject")) return send(422, { message: "Invalid `to` field" }); return send(200, { id: `re_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }); }
      return send(200, { data: [{ name: "designoia.com", status: "verified" }] });
    }
    // ── Google ──
    if (host === "oauth2.googleapis.com") return send(200, { access_token: "ya29.test", refresh_token: "1//refresh", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly" });
    if (host === "www.googleapis.com" && path.startsWith("/oauth2/v3/userinfo")) return send(200, { email: "owner@designoia.com" });
    if (host === "www.googleapis.com" && path.startsWith("/drive/v3/files")) return send(200, { files: [{ id: "sheet1", name: "Leads", modifiedTime: new Date().toISOString() }] });
    if (host === "sheets.googleapis.com") {
      if (/\/values\/.*:append/.test(decodeURIComponent(path))) { state.sheet.push((json as { values: string[][] }).values[0]); return send(200, { updates: { updatedRange: `Sheet1!A${state.sheet.length}` } }); }
      if (path.includes("/values/")) {
        if (req.method === "PUT") {
          const range = decodeURIComponent(path.split("/values/")[1]);
          const row = Number((range.match(/!A(\d+)/) || [])[1]);
          const vals = (json as { values: string[][] }).values[0];
          if (row === 1) state.sheet[0] = vals; else state.sheet[row - 1] = vals;
          return send(200, { updatedRange: range });
        }
        return send(200, { values: state.sheet });
      }
      return send(200, { properties: { title: "Leads" }, sheets: [{ properties: { sheetId: 0, title: "Sheet1", gridProperties: { rowCount: 1000, columnCount: 26 } } }] });
    }
    // ── n8n ──
    if (host === "n8n") {
      if (path === "/healthz") return send(200, { status: "ok" });
      if (path === "/webhook/run" || path.startsWith("/webhook/mytools-run")) { const id = (json as { run_id: string }).run_id; void simulateProcessor(id); return send(200, { message: "Workflow was started" }); }
      if (path.startsWith("/api/v1/workflows")) {
        if (req.headers["x-n8n-api-key"] !== "n8n_test_key") return send(401, { message: "unauthorized" });
        const id = path.split("/")[4];
        if (req.method === "GET" && !id) return send(200, { data: state.n8nWorkflows.map((w) => ({ id: w.id, name: w.name, active: w.active })) });
        if (req.method === "POST" && !id) { const w = { id: `wf${state.n8nWorkflows.length + 1}`, active: false, ...(json as { name: string; nodes: unknown[]; connections: unknown }) }; state.n8nWorkflows.push(w); return send(200, w); }
        const w = state.n8nWorkflows.find((x) => x.id === id);
        if (!w) return send(404, { message: "not found" });
        if (path.endsWith("/activate")) { w.active = true; return send(200, w); }
        if (path.endsWith("/deactivate")) { w.active = false; return send(200, w); }
        if (req.method === "PUT") { Object.assign(w, json); return send(200, w); }
        if (req.method === "DELETE") { state.n8nWorkflows = state.n8nWorkflows.filter((x) => x !== w); return send(200, w); }
      }
    }
    // ── A website (for audits / monitors) ──
    if (host === "site") {
      if (state.siteDown) return send(503, "<h1>Service unavailable</h1>");
      if (path === "/robots.txt") return send(200, "User-agent: *\nSitemap: http://127.0.0.1:" + port + "/site/sitemap.xml", { "Content-Type": "text/plain" });
      if (path === "/sitemap.xml") return send(200, `<?xml version="1.0"?><urlset>${state.siteSitemap.map((p) => `<url><loc>http://127.0.0.1:${port}/site${p}</loc></url>`).join("")}</urlset>`, { "Content-Type": "application/xml" });
      return send(200, `<!doctype html><html lang="en"><head><title>${state.siteTitle}</title><meta name="viewport" content="width=device-width"><meta name="description" content="Fresh coffee and snacks in Geeta Colony, Delhi. Order online or visit us today."></head><body><h1>ABC Cafe</h1><a href="tel:+919876543210">Call</a><p>${"Great coffee. ".repeat(80)}</p><a href="/site/menu">Menu</a></body></html>`);
    }
    // ── WordPress ──
    if (host === "wp") {
      if (path.startsWith("/wp-json/wp/v2/users/me")) return send(200, { name: "Admin", roles: ["administrator"], capabilities: { publish_posts: true } });
      if (path.startsWith("/wp-json/wp/v2/categories")) return send(200, req.method === "GET" ? [] : { id: 7, name: (json as { name: string })?.name });
      if (path.startsWith("/wp-json/wp/v2/tags")) return send(200, req.method === "GET" ? [] : { id: 9 });
      if (/^\/wp-json\/wp\/v2\/(posts|pages)$/.test(path) && req.method === "POST") {
        const b = json as { title: string; status: string };
        const p = { id: 100 + state.wpPosts.length, title: b.title, status: b.status, link: `http://127.0.0.1:${port}/wp/?p=${100 + state.wpPosts.length}` };
        state.wpPosts.push(p);
        return send(201, { ...p, meta: {} });
      }
      return send(200, { id: 1 });
    }
    // ── Generic test endpoints ──
    if (host === "flaky") {
      const key = url.searchParams.get("key") || "x", fails = Number(url.searchParams.get("fails") || 1), status = Number(url.searchParams.get("status") || 503);
      const n = state.flaky.get(key) || 0;
      state.flaky.set(key, n + 1);
      if (n < fails) return send(status, { error: `temporary failure ${n + 1}` }, status === 429 ? { "Retry-After": "1" } : {});
      return send(200, { ok: true, attempt: n + 1 });
    }
    if (host === "bad") return send(400, { error: "invalid record" });
    if (host === "slow") { await sleep(4000); return send(200, { ok: true }); }
    if (host === "echo") return send(200, { received: json });
    if (host === "social") return send(200, { id: `post_${Date.now()}`, url: "https://social.example/p/1" });
    send(404, { error: `mock: no route for ${host}${path}` });
  });
  return new Promise<http.Server>((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

export function metaSignature(secret: string, body: string) { return "sha256=" + createHmac("sha256", secret).update(body).digest("hex"); }
export function svixSignature(secret: string, id: string, ts: string, body: string) { return "v1," + createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${ts}.${body}`).digest("base64"); }

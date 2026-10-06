// Scheduled website / SEO monitoring: fetch → normalize → compare with the
// previous snapshot → decide significance → store → alert.
import tls from "node:tls";
import { db, HttpError } from "./db";
import { fetchPage, normalizeUrl } from "./fetch-page";
import { snapshot, type Snapshot } from "./monitor";
import { notify } from "./notify";
import { createRun, dispatchRun, executeInline, registerKind, type ExecEnv } from "./engine/runs";

type Snap = Snapshot & { ssl_days?: number | null; robots?: boolean; important_present?: boolean | null };
type Change = { kind: string; text: string; significant: boolean; event?: string };

export function sslExpiry(url: string): Promise<Date | null> {
  return new Promise((resolve) => {
    let u: URL;
    try { u = new URL(normalizeUrl(url)); } catch { return resolve(null); }
    if (u.protocol !== "https:") return resolve(null);
    const s = tls.connect({ host: u.hostname, port: Number(u.port) || 443, servername: u.hostname, timeout: 10000, rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate();
      s.end();
      resolve(c?.valid_to ? new Date(c.valid_to) : null);
    });
    s.on("error", () => resolve(null));
    s.on("timeout", () => { s.destroy(); resolve(null); });
  });
}

export function compare(prev: Snap | null, next: Snap, important?: string | null): Change[] {
  const ch: Change[] = [];
  if (!prev) return [{ kind: "baseline", text: "First snapshot saved", significant: false }];
  if (prev.up && !next.up) ch.push({ kind: "down", text: `Website DOWN — ${next.error || "HTTP " + next.status}`, significant: true, event: "down" });
  if (!prev.up && next.up) ch.push({ kind: "up", text: "Website back UP", significant: true, event: "up" });
  if (!next.up) return ch;
  const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
  if (norm(prev.title) !== norm(next.title)) ch.push({ kind: "title", text: `Title changed: "${prev.title}" → "${next.title}"`, significant: true, event: "change" });
  if (norm(prev.metaDescription) !== norm(next.metaDescription)) ch.push({ kind: "meta", text: `Meta description changed: "${prev.metaDescription.slice(0, 80)}" → "${next.metaDescription.slice(0, 80)}"`, significant: true, event: "change" });
  if (norm(prev.h1) !== norm(next.h1)) ch.push({ kind: "h1", text: `H1 changed: "${prev.h1}" → "${next.h1}"`, significant: true, event: "change" });
  if (norm(prev.canonical) !== norm(next.canonical)) ch.push({ kind: "canonical", text: `Canonical changed: ${prev.canonical || "none"} → ${next.canonical || "none"}`, significant: true, event: "change" });
  if (!prev.noindex && next.noindex) ch.push({ kind: "noindex", text: "Page is now NOINDEX (removed from Google)", significant: true, event: "change" });
  if (prev.robots && next.robots === false) ch.push({ kind: "robots", text: "robots.txt disappeared", significant: true, event: "change" });
  if (prev.contentHash !== next.contentHash) {
    const delta = prev.wordCount ? Math.abs(next.wordCount - prev.wordCount) / prev.wordCount : 1;
    ch.push({ kind: "content", text: `Content changed (${prev.wordCount} → ${next.wordCount} words)`, significant: delta > 0.15, event: delta > 0.15 ? "change" : undefined });
  }
  if (important && prev.important_present && next.important_present === false) ch.push({ kind: "important", text: `Important content "${important}" no longer on the page`, significant: true, event: "change" });
  if (prev.sitemapUrls?.length && next.sitemapUrls) {
    if (!next.sitemapUrls.length) ch.push({ kind: "sitemap_failure", text: "Sitemap returned no URLs (missing or broken)", significant: true, event: "change" });
    else {
      const before = new Set(prev.sitemapUrls), after = new Set(next.sitemapUrls);
      const added = next.sitemapUrls.filter((u) => !before.has(u)), removed = prev.sitemapUrls.filter((u) => !after.has(u));
      if (added.length) ch.push({ kind: "new_pages", text: `${added.length} new page(s): ${added.slice(0, 5).join(", ")}${added.length > 5 ? "…" : ""}`, significant: true, event: "new_page" });
      if (removed.length) ch.push({ kind: "removed_pages", text: `${removed.length} page(s) removed: ${removed.slice(0, 5).join(", ")}${removed.length > 5 ? "…" : ""}`, significant: true, event: "page_removed" });
    }
  }
  if (prev.ms && next.ms > Math.max(3000, prev.ms * 3)) ch.push({ kind: "slow", text: `Slow response: ${(next.ms / 1000).toFixed(1)}s (was ${(prev.ms / 1000).toFixed(1)}s)`, significant: false });
  return ch;
}

export async function checkMonitor(ws: string, monitorId: string, runId?: string) {
  const sql = db();
  const [m] = await sql`select * from monitors where id = ${monitorId} and workspace_id = ${ws}`;
  if (!m) throw new HttpError(404, "Monitor not found");
  const full = m.type !== "uptime";
  const base = await snapshot(String(m.url), full && !!m.track_sitemap);
  const snap: Snap = { ...base };
  if (full) {
    const origin = new URL(normalizeUrl(String(m.url))).origin;
    const r = await fetchPage(origin + "/robots.txt", { timeoutMs: 8000, maxBytes: 50_000 });
    snap.robots = r.status === 200 && !/<html/i.test(r.html);
  }
  if (m.important_text) {
    const p = base.up ? await fetchPage(String(m.url)) : null;
    snap.important_present = p ? p.html.toLowerCase().includes(String(m.important_text).toLowerCase()) : null;
  }
  const exp = await sslExpiry(String(m.url));
  snap.ssl_days = exp ? Math.floor((exp.getTime() - Date.now()) / 86400000) : null;
  const changes = compare((m.last_snapshot as Snap) || null, snap, m.important_text as string | null);
  if (snap.ssl_days != null && snap.ssl_days <= 14) changes.push({ kind: "ssl", text: snap.ssl_days < 0 ? "SSL certificate EXPIRED" : `SSL certificate expires in ${snap.ssl_days} days`, significant: true, event: "ssl_expiring" });
  const significant = changes.some((c) => c.significant);
  const stored = { ...snap, excerpt: undefined };
  await sql`insert into monitor_checks (monitor_id, workspace_id, run_id, up, http_status, response_ms, snapshot, changes, significant, error)
    values (${monitorId}, ${ws}, ${runId ?? null}, ${snap.up}, ${snap.status || null}, ${snap.ms}, ${sql.json(stored as never)}, ${sql.json(changes as never)}, ${significant}, ${snap.error ?? null})`;
  await sql`update monitors set last_snapshot = ${sql.json(stored as never)}, current_status = ${snap.up ? "up" : "down"}, last_check_at = now(),
      next_check_at = now() + make_interval(mins => ${Number(m.frequency_minutes)}), checks_total = checks_total + 1, checks_up = checks_up + ${snap.up ? 1 : 0},
      ssl_expires_at = ${exp}, last_change_at = case when ${significant} then now() else last_change_at end, updated_at = now() where id = ${monitorId}`;
  const notifyCfg = (m.notify || {}) as { in_app?: boolean; email?: boolean };
  const label = String(m.label || m.url);
  for (const c of changes.filter((x) => x.significant)) {
    if (notifyCfg.in_app !== false) await notify(ws, { type: `monitor_${c.kind}`, severity: c.kind === "down" || c.kind === "noindex" ? "error" : c.kind === "up" ? "success" : "warning", title: `${label}: ${c.kind === "down" ? "Website Down" : c.kind === "up" ? "Back up" : c.text.split(":")[0]}`, body: c.text, link: `/monitor?id=${monitorId}`, email: !!notifyCfg.email, dedupeKey: c.kind === "ssl" ? `ssl-${monitorId}-${new Date().toISOString().slice(0, 10)}` : undefined });
    if (c.event) { const { emitEvent } = await import("./engine/triggers"); await emitEvent(ws, "monitor_event", { event: c.event, monitor_id: monitorId, url: m.url, label, change: c.text, kind: c.kind }).catch(() => null); }
  }
  return { up: snap.up, status: snap.status, ms: snap.ms, ssl_days: snap.ssl_days, changes, significant };
}

registerKind("monitor", (env: ExecEnv) => checkMonitor(env.ws, String(env.item.input.monitor_id), env.run.id));

export async function monitorTick() {
  const sql = db();
  const due = await sql`select id, workspace_id from monitors where status = 'active' and next_check_at <= now() order by next_check_at limit 200`;
  const by = new Map<string, string[]>();
  for (const d of due) by.set(String(d.workspace_id), [...(by.get(String(d.workspace_id)) || []), String(d.id)]);
  let runs = 0;
  for (const [ws, ids] of by) {
    // Push next_check_at forward immediately so the next tick doesn't double-queue.
    await sql`update monitors set next_check_at = now() + make_interval(mins => frequency_minutes) where id in ${sql(ids)}`;
    const { id } = await createRun({ ws, kind: "monitor", trigger: "schedule", workflowName: "Website monitor checks", records: ids.map((monitor_id) => ({ monitor_id })), maxAttempts: 2 });
    await dispatchRun(ws, id);
    runs++;
  }
  return { checks: due.length, runs };
}

export async function checkNow(ws: string, monitorId: string, userId: string) {
  const { id } = await createRun({ ws, kind: "monitor", trigger: "manual", workflowName: "Website monitor check", records: [{ monitor_id: monitorId }], isTest: true, createdBy: userId, maxAttempts: 1 });
  const r = await executeInline(id, 50000);
  return { run_id: id, ...r };
}

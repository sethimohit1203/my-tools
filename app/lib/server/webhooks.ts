// Secure inbound webhook gateway: API key or HMAC auth, rate limiting,
// body size limit, request log, run creation → n8n.
import type { NextRequest } from "next/server";
import { db, HttpError } from "./db";
import { decrypt, encrypt, hmacHex, randomToken, safeEqual } from "./crypto";
import { hitRateLimit } from "./ratelimit";

export async function createEndpoint(ws: string, o: { workflowId?: string | null; name?: string; method?: string; authMode?: string; ratePerMin?: number }) {
  const secret = `whk_${randomToken(24)}`;
  const [r] = await db()`insert into webhook_endpoints (workspace_id, workflow_id, name, method, auth_mode, secret_enc, secret_prefix, rate_limit_per_min)
    values (${ws}, ${o.workflowId ?? null}, ${o.name || "Webhook"}, ${o.method || "POST"}, ${o.authMode || "api_key"}, ${encrypt({ secret })}, ${secret.slice(0, 8)}, ${o.ratePerMin || 60}) returning id`;
  return { id: String(r.id), secret };
}

export async function regenerateSecret(ws: string, id: string) {
  const secret = `whk_${randomToken(24)}`;
  const [r] = await db()`update webhook_endpoints set secret_enc = ${encrypt({ secret })}, secret_prefix = ${secret.slice(0, 8)}, updated_at = now() where id = ${id} and workspace_id = ${ws} returning id`;
  if (!r) throw new HttpError(404, "Webhook not found");
  return { secret };
}

const MAX_HDR = ["content-type", "user-agent", "x-forwarded-for", "x-request-id", "x-wp-webhook-name", "x-signature", "x-timestamp"];

export async function handleIncoming(req: NextRequest, id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const sql = db();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 404, body: { error: "Unknown webhook" } };
  const [ep] = await sql`select * from webhook_endpoints where id = ${id}`;
  if (!ep) return { status: 404, body: { error: "Unknown webhook" } };
  const ws = String(ep.workspace_id);
  const raw = req.method === "GET" ? "" : await req.text();
  const query = Object.fromEntries([...req.nextUrl.searchParams].filter(([k]) => k !== "key"));
  const headers = Object.fromEntries(MAX_HDR.map((h) => [h, req.headers.get(h)]).filter(([, v]) => v));
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const record = async (status: number, body: Record<string, unknown>, parsed: unknown = null, runId: string | null = null) => {
    await sql`insert into webhook_requests (endpoint_id, workspace_id, method, headers, query, body, status_code, error, run_id, ip)
      values (${id}, ${ws}, ${req.method}, ${sql.json(headers as never)}, ${sql.json(query as never)}, ${parsed == null ? null : sql.json(parsed as never)}, ${status}, ${status >= 400 ? String(body.error || "") : null}, ${runId}, ${ip})`;
    return { status, body };
  };
  if (ep.status !== "active") return record(403, { error: "Webhook is disabled" });
  if (ep.method !== "ANY" && ep.method !== req.method) return record(405, { error: `This webhook accepts ${ep.method} only` });
  if (Buffer.byteLength(raw) > Number(ep.max_body_kb) * 1024) return record(413, { error: `Body too large (max ${ep.max_body_kb} KB)` });

  const { secret } = decrypt<{ secret: string }>(ep.secret_enc as string)!;
  if (ep.auth_mode === "hmac") {
    const ts = req.headers.get("x-timestamp") || "";
    const sig = (req.headers.get("x-signature") || "").replace(/^sha256=/, "");
    if (!ts || !sig) return record(401, { error: "Missing X-Timestamp / X-Signature headers" });
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return record(401, { error: "Timestamp outside the 5-minute window" });
    if (!safeEqual(sig, hmacHex(secret, `${ts}.${raw}`))) return record(401, { error: "Invalid signature" });
  } else {
    const auth = req.headers.get("authorization") || "";
    const key = req.headers.get("x-api-key") || (auth.startsWith("Bearer ") ? auth.slice(7) : "") || req.nextUrl.searchParams.get("key") || "";
    if (!key) return record(401, { error: "Missing API key (X-API-Key header)" });
    if (!safeEqual(key, secret)) return record(403, { error: "Invalid API key" });
  }
  if (!(await hitRateLimit(`wh:${id}`, 60, Number(ep.rate_limit_per_min))) || !(await hitRateLimit(`whws:${ws}`, 60, 600))) return record(429, { error: "Rate limit exceeded — slow down" });

  let parsed: unknown = query;
  if (raw) {
    const ct = req.headers.get("content-type") || "";
    try { parsed = ct.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw); }
    catch { return record(400, { error: "Body must be valid JSON" }); }
  }
  if (parsed == null || typeof parsed !== "object") return record(400, { error: "Body must be a JSON object or array" });
  await sql`update webhook_endpoints set call_count = call_count + 1, last_called_at = now() where id = ${id}`;
  if (!ep.workflow_id) return record(200, { ok: true, received: true, note: "Endpoint not linked to a workflow" }, parsed);

  try {
    const { getWorkflow, startWorkflowRun } = await import("./engine/workflows");
    const wf = await getWorkflow(ws, String(ep.workflow_id));
    if (wf.trigger_type === "wordpress_event") {
      const want = String((wf.definition.trigger.config as Record<string, unknown>).event || "");
      const got = String((parsed as Record<string, unknown>).event || (parsed as Record<string, unknown>).hook || req.headers.get("x-wp-webhook-name") || "");
      if (want && got && want !== got) return record(200, { ok: true, ignored: `event "${got}" doesn't match "${want}"` }, parsed);
    }
    if (wf.status !== "active") return record(403, { error: `Workflow is ${wf.status}` }, parsed);
    const idem = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
    const r = await startWorkflowRun(ws, wf, { trigger: "webhook", records: Array.isArray(parsed) ? parsed : [parsed], idempotencyKey: idem ? `wh:${id}:${idem}` : undefined });
    const body = { ok: true, run_id: r.run_id, status: r.dispatched ? "queued" : "queued_not_dispatched", ...(r.duplicate ? { duplicate: true } : {}), ...(r.error ? { warning: r.error } : {}), status_url: `/automation/runs/${r.run_id}` };
    return record(r.duplicate ? 200 : 201, body, parsed, r.run_id);
  } catch (e) {
    const he = e as HttpError;
    return record(he.status && he.status < 600 ? he.status : 500, { error: he.message || "Internal error" }, parsed);
  }
}

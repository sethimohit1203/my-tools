// End-to-end tests: real app + real Postgres schema + n8n processor simulator
// + local provider mocks. Run: npm run build && npm run test:e2e
import { boot, client, expect, results, shutdown, sleep, sql, test, token, APP, MOCK, ENGINE_SECRET } from "./support/harness.mts";
import { metaSignature, state, svixSignature } from "./support/mocks.mts";

type Run = { id: string; status: string; records_total: number; records_success: number; records_failed: number; records_skipped: number; retry_count: number; dispatch_error?: string };

async function main() {
  console.log("Booting Postgres (PGlite) + mocks + next start…");
  await boot();
  const api = client(await token());
  const other = client(await token("22222222-2222-2222-2222-222222222222", "other@example.com"));

  const waitRun = async (id: string, ms = 60000): Promise<Run & Record<string, unknown>> => {
    const t0 = Date.now();
    for (;;) {
      const { data } = await api<{ run: Run }>("GET", `/api/automation/runs/${id}`);
      if (["completed", "partially_completed", "failed", "cancelled"].includes(data.run?.status)) return data.run as Run & Record<string, unknown>;
      if (Date.now() - t0 > ms) throw new Error(`run ${id} still ${data.run?.status} after ${ms}ms`);
      await sleep(400);
    }
  };
  const runDetail = async (id: string) => (await api<{ run: Run; items: { seq: number; status: string; error: { message: string; http_status: number; provider_response: unknown; recommended_action: string; retry_count: number } | null; attempts: number }[]; steps: { status: string; step_type: string; output: unknown }[]; logs: { message: string; level: string }[] }>("GET", `/api/automation/runs/${id}`)).data;
  // PGlite is single-session: poll through the API and only read SQL once the n8n simulator is idle.
  const waitQuiet = async (campaignId: string) => {
    for (let i = 0; i < 80; i++) {
      const c = await api<{ messages: { step_index: number; status: string }[] }>("GET", `/api/campaigns/${campaignId}`);
      if (!c.data.messages.some((m) => m.step_index === 0 && ["queued", "sending"].includes(m.status)) && !state.simRuns.size) return;
      await sleep(500);
    }
  };
  const mkWorkflow = async (name: string, definition: unknown) => { const r = await api<{ workflow: { id: string } }>("POST", "/api/automation/workflows", { name, definition }); expect(r.status === 200, `create workflow ${r.status} ${JSON.stringify(r.data)}`); return r.data.workflow.id; };
  const activate = (id: string) => api<{ error?: string; details?: string[]; notes?: string[] }>("POST", `/api/automation/workflows/${id}/activate`);
  const run = (id: string, input: unknown) => api<{ run_id: string; dispatched: boolean; error?: string }>("POST", `/api/automation/workflows/${id}/run`, { input });

  console.log("\n— Auth & integrations");
  await test("unauthenticated request → 401", async () => { const r = await fetch(APP + "/api/me"); expect(r.status === 401, `got ${r.status}`); });
  await test("first sign-in creates a workspace", async () => { const r = await api<{ workspace: { id: string } }>("GET", "/api/me"); expect(r.status === 200 && r.data.workspace?.id, JSON.stringify(r.data)); });
  await test("capabilities start as not configured (no fake 'connected')", async () => { const r = await api<{ capabilities: Record<string, boolean> }>("GET", "/api/me"); expect(!r.data.capabilities.ai && !r.data.capabilities.n8n && !r.data.capabilities.whatsapp, JSON.stringify(r.data.capabilities)); });
  await test("integration secrets are never returned to the browser", async () => {
    const s = await api("POST", "/api/integrations/ai", { provider: "groq", api_key: "gsk_secret_value", rate_per_minute: "1000" });
    expect(s.status === 200 && (s.data as { ok: boolean }).ok, `save+test failed ${JSON.stringify(s.data)}`);
    const l = await api<{ integrations: { provider: string; status: string; secretsSet: Record<string, boolean>; config: Record<string, string> }[] }>("GET", "/api/integrations");
    expect(!JSON.stringify(l.data).includes("gsk_secret_value"), "secret leaked in list");
    const ai = l.data.integrations.find((i) => i.provider === "ai")!;
    expect(ai.status === "connected" && ai.secretsSet.api_key, JSON.stringify(ai));
    const [row] = await sql`select secrets from integrations where provider = 'ai'`;
    expect(String(row.secrets).startsWith("v1.") && !String(row.secrets).includes("gsk_"), "secret not encrypted at rest");
  });
  await test("failed connection test is stored as error, not connected", async () => {
    const r = await api<{ ok: boolean; message: string }>("POST", "/api/integrations/n8n", { base_url: "http://127.0.0.1:1", api_key: "" });
    expect(r.data.ok === false, JSON.stringify(r.data));
    const l = await api<{ integrations: { provider: string; status: string; lastError: string }[] }>("GET", "/api/integrations");
    const n = l.data.integrations.find((i) => i.provider === "n8n")!;
    expect(n.status === "error" && n.lastError, JSON.stringify(n));
  });
  await test("workspace isolation: another user can't see this workspace's integrations", async () => {
    const l = await other<{ integrations: { provider: string; status: string }[] }>("GET", "/api/integrations");
    expect(l.data.integrations.every((i) => i.status === "not_configured"), JSON.stringify(l.data).slice(0, 200));
  });

  console.log("\n— Missing credentials");
  let waWf = "";
  await test("activating a WhatsApp workflow without WhatsApp → 400 Integration Required", async () => {
    waWf = await mkWorkflow("WA test", { trigger: { type: "manual", config: {} }, steps: [{ key: "wa", type: "send_whatsapp", name: "WA", config: { to: "{{phone}}", template: "lead_intro" } }] });
    const r = await activate(waWf);
    expect(r.status === 400 && JSON.stringify(r.data).includes("Integration Required: whatsapp"), JSON.stringify(r.data));
  });
  await test("manual run of a non-active workflow is refused (409)", async () => { const r = await run(waWf, [{}]); expect(r.status === 409, `${r.status}`); });

  console.log("\n— n8n");
  await test("n8n API install creates & activates Run Processor + Ticker", async () => {
    const r = await api<{ ok: boolean; message: string }>("POST", "/api/integrations/n8n", { base_url: `${MOCK}/n8n`, api_key: "n8n_test_key" });
    expect(r.data.ok, JSON.stringify(r.data));
    const i = await api<{ runWebhookUrl: string }>("POST", "/api/integrations/n8n/install");
    expect(i.status === 200 && i.data.runWebhookUrl?.includes("/webhook/mytools-run"), JSON.stringify(i.data));
    expect(state.n8nWorkflows.length === 2 && state.n8nWorkflows.every((w) => w.active), "workflows not active");
    const proc = state.n8nWorkflows.find((w) => w.name.includes("Run Processor"))!;
    const types = (proc.nodes as { type: string }[]).map((n) => n.type).join(",");
    expect(/webhook/.test(types) && /httpRequest/.test(types) && /n8n-nodes-base.wait/.test(types) && /n8n-nodes-base.if/.test(types), types);
    expect(JSON.stringify(proc).includes(ENGINE_SECRET) && JSON.stringify(proc).includes("/api/engine/step"), "processor not wired to engine");
    const me = await api<{ capabilities: Record<string, boolean> }>("GET", "/api/me");
    expect(me.data.capabilities.n8n, "n8n capability false after install");
  });
  await test("engine endpoints reject requests without the engine secret", async () => {
    const r = await fetch(APP + "/api/engine/tick", { method: "POST", body: "{}" });
    expect(r.status === 401, `${r.status}`);
  });

  console.log("\n— Workflow execution");
  let bulkWf = "";
  for (const n of [10, 100, 500]) {
    await test(`bulk run with ${n} records completes with exact counts`, async () => {
      if (!bulkWf) {
        bulkWf = await mkWorkflow("Bulk", { trigger: { type: "manual", config: {} }, steps: [
          { key: "calc", type: "transform", name: "calc", config: { fields: [{ key: "pct", value: "=round({{present}}/{{total}}*100,1)" }] } },
          { key: "cond", type: "condition", name: "low", config: { rules: [{ left: "pct", op: "lt", right: "75" }], onFalse: "stop" } },
          { key: "flag", type: "transform", name: "flag", config: { fields: [{ key: "flag", value: "LOW" }] } },
        ] });
        const a = await activate(bulkWf); expect(a.status === 200, JSON.stringify(a.data));
      }
      const recs = Array.from({ length: n }, (_, i) => ({ present: i % 2 ? 10 : 20, total: 20 }));
      const r = await run(bulkWf, recs);
      expect(r.data.dispatched, JSON.stringify(r.data));
      const done = await waitRun(r.data.run_id, 120000);
      expect(done.status === "completed" && done.records_total === n && done.records_success === n / 2 && done.records_skipped === n / 2, JSON.stringify(done));
    });
  }

  let partialRun = "";
  await test("a failing record doesn't stop the run → partially_completed with provider error stored", async () => {
    const wf = await mkWorkflow("Partial", { trigger: { type: "manual", config: {} }, steps: [{ key: "call", type: "http_request", name: "Call API", config: { method: "POST", url: `${MOCK}/{{target}}`, body: "{\"id\":\"{{id}}\"}" } }] });
    await activate(wf);
    const r = await run(wf, [{ id: 1, target: "echo" }, { id: 2, target: "bad" }, { id: 3, target: "echo" }]);
    const done = await waitRun(r.data.run_id);
    partialRun = done.id;
    expect(done.status === "partially_completed" && done.records_success === 2 && done.records_failed === 1, JSON.stringify(done));
    const d = await runDetail(done.id);
    const failed = d.items.find((i) => i.status === "failed")!;
    expect(failed.seq === 2 && failed.error?.http_status === 400 && failed.error?.provider_response && failed.error?.recommended_action, JSON.stringify(failed));
    expect(failed.attempts === 1, `400 should not be retried, attempts=${failed.attempts}`);
    expect(d.logs.some((l) => l.message.includes("Partially completed")), "timeline missing final status");
  });

  await test("temporary 503 errors are retried with backoff, then succeed", async () => {
    const wf = await mkWorkflow("Flaky", { trigger: { type: "manual", config: {} }, steps: [{ key: "call", type: "http_request", name: "Flaky API", config: { method: "POST", url: `${MOCK}/flaky?key=f503&fails=2&status=503`, body: "{}" } }] });
    await activate(wf);
    const done = await waitRun((await run(wf, [{}])).data.run_id, 60000);
    const d = await runDetail(done.id);
    expect(done.status === "completed", JSON.stringify(done));
    expect(d.steps.filter((s) => s.status === "retrying").length === 2 && d.items[0].attempts === 2, JSON.stringify(d.steps.map((s) => s.status)));
  });
  await test("HTTP 429 with Retry-After is retried", async () => {
    const wf = await mkWorkflow("429", { trigger: { type: "manual", config: {} }, steps: [{ key: "call", type: "http_request", name: "Limited API", config: { method: "POST", url: `${MOCK}/flaky?key=f429&fails=1&status=429`, body: "{}" } }] });
    await activate(wf);
    const done = await waitRun((await run(wf, [{}])).data.run_id, 60000);
    expect(done.status === "completed", JSON.stringify(done));
  });
  await test("timeouts are retried then marked permanently failed after max attempts", async () => {
    const wf = await mkWorkflow("Timeout", { trigger: { type: "manual", config: {} }, steps: [{ key: "call", type: "http_request", name: "Slow API", config: { method: "POST", url: `${MOCK}/slow`, body: "{}", timeout_ms: 500 } }] });
    await activate(wf);
    const done = await waitRun((await run(wf, [{}])).data.run_id, 60000);
    const d = await runDetail(done.id);
    expect(done.status === "failed" && d.items[0].attempts === 3 && d.items[0].error?.retry_count === 3, JSON.stringify({ s: done.status, a: d.items[0].attempts, e: d.items[0].error }));
  });
  await test("retry failed records resumes only the failed ones", async () => {
    const r = await api<{ id: string }>("POST", `/api/automation/runs/${partialRun}/retry_failed`);
    expect(r.status === 200, JSON.stringify(r.data));
    const done = await waitRun(r.data.id);
    expect(done.records_total === 1 && done.status === "failed", `retried record should hit the same 400 again: ${JSON.stringify(done)}`);
    const parent = await runDetail(partialRun);
    expect(parent.run.retry_count === 1, "retry_count not incremented");
  });
  await test("cancel stops pending/waiting records", async () => {
    const wf = await mkWorkflow("Delay", { trigger: { type: "manual", config: {} }, steps: [{ key: "w", type: "delay", name: "wait", config: { amount: 10, unit: "minutes" } }, { key: "t", type: "transform", name: "t", config: { fields: [{ key: "x", value: "1" }] } }] });
    await activate(wf);
    const r = await run(wf, [{}, {}, {}]);
    await sleep(2500);
    const c = await api("POST", `/api/automation/runs/${r.data.run_id}/cancel`);
    expect(c.status === 200, JSON.stringify(c.data));
    const done = await waitRun(r.data.run_id);
    expect(done.status === "cancelled" && done.records_success === 0, JSON.stringify(done));
  });
  await test("pause → run paused; resume → run continues to completion", async () => {
    const wf = await mkWorkflow("PauseResume", { trigger: { type: "manual", config: {} }, steps: [{ key: "call", type: "http_request", name: "slowish", config: { method: "POST", url: `${MOCK}/flaky?key=pr&fails=3&status=503`, body: "{}" } }], settings: { maxAttempts: 5 } });
    await activate(wf);
    const r = await run(wf, [{}]);
    await sleep(800);
    await api("POST", `/api/automation/workflows/${wf}/pause`);
    await sleep(3500);
    const mid = await runDetail(r.data.run_id);
    expect(mid.run.status === "paused", `expected paused, got ${mid.run.status}`);
    await api("POST", `/api/automation/workflows/${wf}/resume`);
    const done = await waitRun(r.data.run_id, 60000);
    expect(done.status === "completed", JSON.stringify(done));
  });

  console.log("\n— Test mode & dry runs");
  await test("test run with WhatsApp step is a dry run (no API call) and shows expected action", async () => {
    await api("POST", "/api/integrations/whatsapp", { phone_number_id: "PNID1", business_account_id: "WABA1", access_token: "EAAG_secret", app_secret: "wa_app_secret" });
    const before = state.calls.filter((c) => c.path.endsWith("/messages")).length;
    const t = await api<{ run_id: string; status: string }>("POST", `/api/automation/workflows/${waWf}/test`, { input: { phone: "9876543210" } });
    expect(t.status === 200 && t.data.status === "completed", JSON.stringify(t.data));
    const d = await runDetail(t.data.run_id);
    expect(d.steps[0].status === "dry_run" && JSON.stringify(d.steps[0].output).includes("would"), JSON.stringify(d.steps));
    expect(state.calls.filter((c) => c.path.endsWith("/messages")).length === before, "dry run called the WhatsApp API");
  });
  await test("test run with explicit confirmation really sends", async () => {
    const before = state.calls.filter((c) => c.path.endsWith("/messages")).length;
    const t = await api<{ run_id: string; status: string }>("POST", `/api/automation/workflows/${waWf}/test`, { input: { phone: "9876543210" }, confirm_live: true });
    expect(t.data.status === "completed", JSON.stringify(t.data));
    expect(state.calls.filter((c) => c.path.endsWith("/messages")).length === before + 1, "live test didn't call the API");
  });

  console.log("\n— Webhook gateway");
  let hookWf = "", ep = "", secret = "";
  await test("webhook endpoint auto-created on activation", async () => {
    hookWf = await mkWorkflow("Hook", { trigger: { type: "webhook", config: {} }, steps: [{ key: "t", type: "transform", name: "t", config: { fields: [{ key: "greeting", value: "Hi {{name}}" }] } }] });
    const a = await activate(hookWf);
    expect(a.status === 200, JSON.stringify(a.data));
    const l = await api<{ webhooks: { id: string; workflow_id: string }[] }>("GET", "/api/automation/webhooks");
    ep = l.data.webhooks.find((w) => w.workflow_id === hookWf)!.id;
    secret = (await api<{ secret: string }>("POST", `/api/automation/webhooks/${ep}/reveal`)).data.secret;
    expect(ep && secret.startsWith("whk_"), "no endpoint/secret");
  });
  const hook = (init: RequestInit & { path?: string } = {}) => fetch(`${APP}/api/hooks/${init.path ?? ep}`, { method: "POST", ...init });
  await test("401 without API key", async () => { const r = await hook({ body: "{}" }); expect(r.status === 401, `${r.status}`); });
  await test("403 with wrong API key", async () => { const r = await hook({ body: "{}", headers: { "x-api-key": "whk_wrong" } }); expect(r.status === 403, `${r.status}`); });
  await test("400 for invalid JSON", async () => { const r = await hook({ body: "{nope", headers: { "x-api-key": secret, "content-type": "application/json" } }); expect(r.status === 400, `${r.status}`); });
  await test("404 for unknown endpoint", async () => { const r = await hook({ path: "00000000-0000-0000-0000-000000000000", body: "{}" }); expect(r.status === 404, `${r.status}`); });
  await test("413 for oversized body", async () => { const r = await hook({ body: JSON.stringify({ x: "a".repeat(300 * 1024) }), headers: { "x-api-key": secret } }); expect(r.status === 413, `${r.status}`); });
  let hookRun = "";
  await test("201 creates a run that n8n executes; Idempotency-Key prevents duplicates", async () => {
    const h = { "x-api-key": secret, "content-type": "application/json", "idempotency-key": "evt-1" };
    const r1 = await hook({ body: JSON.stringify({ name: "Asha" }), headers: h });
    const b1 = (await r1.json()) as { run_id: string };
    const r2 = await hook({ body: JSON.stringify({ name: "Asha" }), headers: h });
    const b2 = (await r2.json()) as { run_id: string; duplicate: boolean };
    expect(r1.status === 201 && r2.status === 200 && b2.duplicate && b1.run_id === b2.run_id, `${r1.status} ${r2.status} ${JSON.stringify(b2)}`);
    hookRun = b1.run_id;
    const done = await waitRun(hookRun);
    expect(done.status === "completed", JSON.stringify(done));
    const d = await runDetail(hookRun);
    expect(JSON.stringify(d.steps[0].output).includes("Hi Asha"), JSON.stringify(d.steps[0].output));
  });
  await test("HMAC mode verifies signatures", async () => {
    await api("POST", `/api/automation/webhooks/${ep}/settings`, { auth_mode: "hmac" });
    const body = JSON.stringify({ name: "Ravi" }), ts = String(Math.floor(Date.now() / 1000));
    const { createHmac } = await import("node:crypto");
    const good = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    const bad = await hook({ body, headers: { "x-timestamp": ts, "x-signature": "sha256=deadbeef" } });
    const ok = await hook({ body, headers: { "x-timestamp": ts, "x-signature": `sha256=${good}`, "content-type": "application/json" } });
    expect(bad.status === 401 && ok.status === 201, `${bad.status} ${ok.status}`);
    await api("POST", `/api/automation/webhooks/${ep}/settings`, { auth_mode: "api_key" });
  });
  await test("429 when the endpoint's rate limit is exceeded", async () => {
    await api("POST", `/api/automation/webhooks/${ep}/settings`, { rate_limit_per_min: 2 });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await hook({ body: JSON.stringify({ name: `n${i}` }), headers: { "x-api-key": secret, "content-type": "application/json" } })).status);
    expect(codes.includes(429), codes.join(","));
    await api("POST", `/api/automation/webhooks/${ep}/settings`, { rate_limit_per_min: 60 });
  });
  await test("disabled endpoint → 403; request log stored", async () => {
    await api("POST", `/api/automation/webhooks/${ep}/disable`);
    const r = await hook({ body: "{}", headers: { "x-api-key": secret } });
    await api("POST", `/api/automation/webhooks/${ep}/enable`);
    const log = await api<{ requests: { status_code: number }[] }>("GET", `/api/automation/webhooks/${ep}`);
    expect(r.status === 403 && log.data.requests.some((q) => q.status_code === 201) && log.data.requests.some((q) => q.status_code === 401), `${r.status}`);
  });

  console.log("\n— AI structured output");
  await test("AI Analyze returns validated JSON; invalid output fails after repair (record-level)", async () => {
    const wf = await mkWorkflow("AI", { trigger: { type: "manual", config: {} }, steps: [{ key: "ai", type: "ai_analyze", name: "AI", config: { instruction: "Score {{name}}", outputs: "lead_score:number, priority:enum(HIGH|MEDIUM|LOW), pitch:string" } }] });
    await activate(wf);
    const done = await waitRun((await run(wf, [{ name: "Good Co" }, { name: "BAD_AI Co" }])).data.run_id, 60000);
    const d = await runDetail(done.id);
    expect(done.status === "partially_completed", JSON.stringify(done));
    const ok = d.steps.find((s) => s.status === "success")!;
    expect((ok.output as { lead_score: number; priority: string }).lead_score === 82 && (ok.output as { priority: string }).priority === "HIGH", JSON.stringify(ok.output));
    expect(d.items.find((i) => i.status === "failed")?.error?.message.includes("failed validation after repair"), "invalid AI output not reported");
  });

  console.log("\n— Leads, WhatsApp campaign, webhooks");
  await test("leads import dedupes on source_ref", async () => {
    const leads = [
      { name: "Cafe One", phone: "9876500001", email: "one@cafe.in", lead_score: 80, source_ref: "osm-1", city: "Delhi" },
      { name: "Cafe Two", phone: "9876500002", email: "two@cafe.in", lead_score: 75, source_ref: "osm-2", city: "Delhi" },
      { name: "Cafe Opted", phone: "9876500003", email: "three@cafe.in", lead_score: 70, source_ref: "osm-3" },
      { name: "Bad Phone", phone: "12", email: "bad-email", lead_score: 70, source_ref: "osm-4" },
      { name: "No Contact", lead_score: 90, source_ref: "osm-5" },
      { name: "Not on WA", phone: "9876500000", email: "reject@cafe.in", lead_score: 72, source_ref: "osm-6" },
    ];
    const a = await api<{ created: number; updated: number }>("POST", "/api/leads/import", { leads });
    const b = await api<{ created: number; updated: number }>("POST", "/api/leads/import", { leads: leads.slice(0, 2) });
    expect(a.data.created === 6 && b.data.created === 0 && b.data.updated === 2, `${JSON.stringify(a.data)} ${JSON.stringify(b.data)}`);
    await api("POST", "/api/suppression", { channel: "whatsapp", address: "9876500003", reason: "opted out earlier" });
  });
  let camp = "";
  await test("campaign eligibility preview counts every exclusion", async () => {
    const c = await api<{ campaign: { id: string } }>("POST", "/api/campaigns", { name: "WA test", channel: "whatsapp", audience_filter: { min_score: 60 }, steps: [{ day: 0, template: "lead_intro", params: "{{name}}, websites" }, { day: 2, template: "lead_intro", params: "{{name}}, follow-up" }], settings: { daily_limit: 100, min_delay_sec: 0, working_hours: { start: "00:00", end: "23:59" }, days: [0, 1, 2, 3, 4, 5, 6] } });
    camp = c.data.campaign.id;
    const p = await api<{ total: number; eligible: number; excluded: Record<string, number>; messages_to_send: number }>("POST", `/api/campaigns/${camp}/preview`);
    expect(p.data.total === 6 && p.data.eligible === 3 && p.data.excluded.opted_out === 1 && p.data.excluded.invalid === 1 && p.data.excluded.no_contact === 1 && p.data.messages_to_send === 6, JSON.stringify(p.data));
  });
  await test("start requires explicit confirmation", async () => { const r = await api("POST", `/api/campaigns/${camp}/start`, {}); expect(r.status === 400, `${r.status}`); });
  await test("ticker sends due messages through n8n; invalid number fails permanently; others sent", async () => {
    const s = await api<{ queued: number }>("POST", `/api/campaigns/${camp}/start`, { confirm: true });
    expect(s.data.queued === 3, JSON.stringify(s.data));
    await sleep(1500);
    const t = await fetch(APP + "/api/engine/tick", { method: "POST", headers: { "x-engine-secret": ENGINE_SECRET } });
    expect(t.ok, `tick ${t.status}`);
    await waitQuiet(camp);
    const msgs = await sql`select to_address, status, provider_message_id, error from campaign_messages where campaign_id = ${camp} and step_index = 0 order by to_address`;
    const sent = msgs.filter((m) => m.status === "sent"), failed = msgs.filter((m) => m.status === "failed");
    expect(sent.length === 2 && sent.every((m) => String(m.provider_message_id).startsWith("wamid.")) && failed.length === 1 && String(failed[0].error).includes("131026") === false, JSON.stringify(msgs));
    const [fu] = await sql`select count(*)::int as n from campaign_messages where campaign_id = ${camp} and step_index = 1 and status = 'queued'`;
    expect(fu.n === 2, `follow-ups queued: ${fu.n}`);
  });
  await test("WhatsApp webhook: bad signature rejected; delivered/read update status", async () => {
    const [m] = await sql`select provider_message_id from campaign_messages where campaign_id = ${camp} and status = 'sent' limit 1`;
    const payload = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "PNID1" }, statuses: [{ id: m.provider_message_id, status: "read" }] } }] }] });
    const bad = await fetch(APP + "/api/webhooks/whatsapp", { method: "POST", body: payload, headers: { "x-hub-signature-256": "sha256=00" } });
    const ok = await fetch(APP + "/api/webhooks/whatsapp", { method: "POST", body: payload, headers: { "x-hub-signature-256": metaSignature("wa_app_secret", payload) } });
    const [after] = await sql`select status, read_at from campaign_messages where provider_message_id = ${m.provider_message_id}`;
    expect(bad.status === 401 && ok.status === 200 && after.status === "read" && after.read_at, `${bad.status} ${ok.status} ${JSON.stringify(after)}`);
  });
  await test("reply stops the sequence for that lead; STOP opts out + suppression", async () => {
    const send = (from: string, text: string) => { const p = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "PNID1" }, messages: [{ id: `in.${from}.${Date.now()}`, from, type: "text", text: { body: text } }] } }] }] }); return fetch(APP + "/api/webhooks/whatsapp", { method: "POST", body: p, headers: { "x-hub-signature-256": metaSignature("wa_app_secret", p) } }); };
    await send("919876500001", "Yes please call me");
    await send("919876500002", "STOP");
    const cl = await sql`select address, status from campaign_leads where campaign_id = ${camp} order by address`;
    const st = Object.fromEntries(cl.map((r) => [r.address, r.status]));
    const [q] = await sql`select count(*)::int as n from campaign_messages where campaign_id = ${camp} and step_index = 1 and status = 'queued'`;
    const [sup] = await sql`select reason from suppression_list where address = '919876500002' and channel = 'whatsapp'`;
    const [lead] = await sql`select stage from leads where phone = '9876500001'`;
    expect(st["919876500001"] === "replied" && st["919876500002"] === "opted_out" && q.n === 0 && sup && lead.stage === "Interested", JSON.stringify({ st, q: q.n, sup, lead }));
  });

  console.log("\n— Email campaign (Resend) + bounce webhook");
  await test("email campaign sends via Resend with unsubscribe link; bounce webhook suppresses", async () => {
    await api("POST", "/api/integrations/resend", { from: "Designoia <hi@designoia.com>", api_key: "re_key", webhook_secret: "whsec_" + Buffer.from("resend-test-secret").toString("base64") });
    const c = await api<{ campaign: { id: string } }>("POST", "/api/campaigns", { name: "Email test", channel: "email", audience_filter: { min_score: 60 }, steps: [{ day: 0, subject: "Idea for {{name}}", body: "Hi {{name}}, {{service}}" }], settings: { provider: "resend", daily_limit: 100, min_delay_sec: 0, working_hours: { start: "00:00", end: "23:59" }, days: [0, 1, 2, 3, 4, 5, 6], recontact_days: 0 } });
    const id = c.data.campaign.id;
    const s = await api<{ queued: number }>("POST", `/api/campaigns/${id}/start`, { confirm: true });
    expect(s.status === 200, JSON.stringify(s.data));
    await sleep(1500);
    await fetch(APP + "/api/engine/tick", { method: "POST", headers: { "x-engine-secret": ENGINE_SECRET } });
    await waitQuiet(id);
    const msgs = await sql`select to_address, status, provider_message_id, body from campaign_messages where campaign_id = ${id}`;
    const sent = msgs.filter((m) => m.status === "sent");
    expect(sent.length >= 2 && String(sent[0].body).includes("/api/unsubscribe?t="), JSON.stringify(msgs));
    const rejected = msgs.find((m) => m.to_address === "reject@cafe.in");
    expect(!rejected || rejected.status === "failed", `rejected address should fail: ${JSON.stringify(rejected)}`);
    const evt = JSON.stringify({ type: "email.bounced", data: { email_id: sent[0].provider_message_id, bounce: { message: "Mailbox does not exist" } } });
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await fetch(APP + "/api/webhooks/resend", { method: "POST", body: evt, headers: { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": svixSignature("whsec_" + Buffer.from("resend-test-secret").toString("base64"), "msg_1", ts, evt) } });
    const [sup] = await sql`select reason from suppression_list where channel = 'email' and address = ${sent[0].to_address}`;
    expect(r.status === 200 && sup?.reason === "bounced", `${r.status} ${JSON.stringify(sup)}`);
  });
  await test("unsubscribe link adds to suppression permanently", async () => {
    const [m] = await sql`select body from campaign_messages where channel = 'email' and status = 'sent' limit 1`;
    const t = String(m.body).match(/unsubscribe\?t=([^\s]+)/)![1];
    const r = await fetch(`${APP}/api/unsubscribe`, { method: "POST", body: new URLSearchParams({ t }) });
    const text = await r.text();
    expect(r.ok && text.includes("unsubscribed"), text.slice(0, 200));
  });

  console.log("\n— WordPress, monitors, social, reports, schedules, Google Sheets");
  await test("WordPress: create post; same external ID never creates a duplicate", async () => {
    const s = await api<{ ok: boolean; message: string }>("POST", "/api/integrations/wordpress", { url: `${MOCK}/wp`, username: "admin", app_password: "xxxx" });
    expect(s.data.ok, JSON.stringify(s.data));
    const wf = await mkWorkflow("WP", { trigger: { type: "manual", config: {} }, steps: [{ key: "wp", type: "wordpress", name: "post", config: { operation: "create_post", external_id: "row-{{id}}", title: "Post {{id}}", content: "<p>Hello</p>", status: "publish" } }] });
    await activate(wf);
    const before = state.wpPosts.length;
    await waitRun((await run(wf, [{ id: 1 }, { id: 2 }])).data.run_id);
    const d2 = await waitRun((await run(wf, [{ id: 1 }])).data.run_id);
    const det = await runDetail(d2.id);
    expect(state.wpPosts.length === before + 2 && JSON.stringify(det.steps[0].output).includes("duplicate"), `${state.wpPosts.length - before} ${JSON.stringify(det.steps[0].output)}`);
  });
  let mon = "";
  await test("monitor: baseline, then title change + downtime detected as significant alerts", async () => {
    const m = await api<{ monitor: { id: string } }>("POST", "/api/monitors", { url: `${MOCK}/site/`, label: "ABC Cafe", type: "full", frequency_minutes: 360 });
    mon = m.data.monitor.id;
    const c1 = await api<{ status: string }>("POST", `/api/monitors/${mon}/check`);
    expect(c1.data.status === "completed", JSON.stringify(c1.data));
    state.siteTitle = "ABC Cafe — NEW MENU";
    await api("POST", `/api/monitors/${mon}/check`);
    state.siteDown = true;
    await api("POST", `/api/monitors/${mon}/check`);
    state.siteDown = false;
    const h = await api<{ checks: { up: boolean; significant: boolean; changes: { kind: string }[] }[]; monitor: { current_status: string } }>("GET", `/api/monitors/${mon}`);
    const kinds = h.data.checks.flatMap((c) => c.changes.map((x) => x.kind));
    const n = await api<{ notifications: { type: string }[] }>("GET", "/api/notifications");
    expect(kinds.includes("title") && kinds.includes("down") && h.data.monitor.current_status === "down" && n.data.notifications.some((x) => x.type === "monitor_down"), JSON.stringify({ kinds, n: n.data.notifications.map((x) => x.type) }));
  });
  await test("social: duplicate content refused; approved post published by ticker via n8n", async () => {
    await api("POST", "/api/integrations/social_webhook", { url: `${MOCK}/social` });
    const p = await api<{ post: { id: string } }>("POST", "/api/social/posts", { platform: "webhook", caption: "Launch day! 🚀", hashtags: "#designoia" });
    const dup = await api("POST", "/api/social/posts", { platform: "webhook", caption: "Launch day! 🚀", hashtags: "#designoia" });
    expect(dup.status === 409, `dup ${dup.status}`);
    await api("POST", `/api/social/posts/${p.data.post.id}/submit`);
    await api("POST", `/api/social/posts/${p.data.post.id}/approve`);
    await fetch(APP + "/api/engine/tick", { method: "POST", headers: { "x-engine-secret": ENGINE_SECRET } });
    for (let i = 0; i < 40; i++) { const l = await api<{ posts: { id: string; status: string }[] }>("GET", "/api/social/posts"); if (l.data.posts.find((x) => x.id === p.data.post.id)?.status === "published" && !state.simRuns.size) break; await sleep(500); }
    const [x] = await sql`select status, provider_post_id from social_posts where id = ${p.data.post.id}`;
    expect(x.status === "published" && x.provider_post_id, JSON.stringify(x));
  });
  await test("report: generated from real audit data with AI analysis + downloadable PDF", async () => {
    const r = await api<{ report: { id: string } }>("POST", "/api/reports", { name: "ABC monthly", type: "website_audit", config: { url: `${MOCK}/site/`, client: "ABC Cafe" } });
    const g = await api<{ run_id: string; report_run_id: string }>("POST", `/api/reports/${r.data.report.id}/generate`, {});
    expect(g.status === 200, JSON.stringify(g.data));
    const done = await waitRun(g.data.run_id, 60000);
    expect(done.status === "completed", JSON.stringify(done));
    const rep = await api<{ runs: { status: string; analysis: Record<string, unknown>; data: { website: { score: number } }; warnings: string[] }[] }>("GET", `/api/reports/${r.data.report.id}`);
    const rr = rep.data.runs[0];
    expect(rr.status === "completed" && rr.analysis?.executive_summary && rr.data.website.score > 0, JSON.stringify(rr).slice(0, 300));
    const pdf = await fetch(`${APP}/api/reports/runs/${g.data.report_run_id}/pdf`, { headers: { Authorization: `Bearer ${await token()}` } });
    const buf = Buffer.from(await pdf.arrayBuffer());
    expect(pdf.ok && buf.subarray(0, 4).toString() === "%PDF", `pdf ${pdf.status}`);
  });
  await test("schedule (once) fires via the ticker exactly once", async () => {
    const at = new Date(Date.now() + 3000).toISOString();
    const wf = await mkWorkflow("Sched", { trigger: { type: "schedule", config: { kind: "once", run_at: at, input: "[{\"x\":1}]" } }, steps: [{ key: "t", type: "transform", name: "t", config: { fields: [{ key: "y", value: "{{x}}" }] } }] });
    const a = await activate(wf);
    expect(a.status === 200, JSON.stringify(a.data));
    await sleep(4000);
    await fetch(APP + "/api/engine/tick", { method: "POST", headers: { "x-engine-secret": ENGINE_SECRET } });
    await fetch(APP + "/api/engine/tick", { method: "POST", headers: { "x-engine-secret": ENGINE_SECRET } });
    const runs = await api<{ runs: { id: string; trigger: string }[] }>("GET", `/api/automation/runs?workflow_id=${wf}`);
    expect(runs.data.runs.length === 1 && runs.data.runs[0].trigger === "schedule", JSON.stringify(runs.data.runs));
    expect((await waitRun(runs.data.runs[0].id)).status === "completed", "scheduled run not completed");
  });
  await test("Google OAuth connect + Sheets new-row trigger processes only new rows, once", async () => {
    const st = await api<{ url: string }>("POST", "/api/oauth/google/start");
    const state_ = new URL(st.data.url).searchParams.get("state")!;
    const cb = await fetch(`${APP}/api/oauth/google/callback?code=abc&state=${encodeURIComponent(state_)}`, { redirect: "manual" });
    expect(cb.status === 307 && String(cb.headers.get("location")).includes("google=connected"), `${cb.status} ${cb.headers.get("location")}`);
    const wf = await mkWorkflow("Sheet", { trigger: { type: "sheets_new_row", config: { spreadsheet_id: "sheet1", sheet: "Sheet1" } }, steps: [
      { key: "ai", type: "ai_analyze", name: "AI", config: { instruction: "Score {{Name}}", outputs: "lead_score:number" } },
      { key: "w", type: "sheets_write", name: "write", config: { spreadsheet_id: "sheet1", sheet: "Sheet1", mode: "update", key_column: "_row", row: [{ key: "Score", value: "{{lead_score}}" }] } },
    ] });
    const a = await activate(wf);
    expect(a.status === 200, JSON.stringify(a.data));
    const scan = () => api<{ baseline?: number; new_rows?: number; run_id?: string }>("POST", `/api/automation/workflows/${wf}/scan`);
    const b = await scan();
    expect(b.data.baseline === 1, `baseline ${JSON.stringify(b.data)}`);
    state.sheet.push(["Chai Point", "cafe", "9811111111"], ["Coffee Home", "cafe", "9822222222"]);
    const s1 = await scan();
    expect(s1.data.new_rows === 2, JSON.stringify(s1.data));
    const s2 = await scan();
    expect(!s2.data.new_rows, `rescan duplicated: ${JSON.stringify(s2.data)}`);
    const done = await waitRun(s1.data.run_id!, 60000);
    expect(done.status === "completed" && state.sheet[0].includes("Score") && state.sheet[2][state.sheet[0].indexOf("Score")] === "82", `${done.status} ${JSON.stringify(state.sheet)}`);
  });
  await test("AI processor: 100 CSV rows processed in background with exportable results", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ business: `Biz ${i}`, city: "Delhi" }));
    const r = await api<{ run_id: string }>("POST", "/api/automation/ai-processor", { source: "csv", rows, instruction: "Classify", outputs: "priority:enum(HIGH|LOW), pitch:string" });
    const done = await waitRun(r.data.run_id, 120000);
    expect(done.status === "completed" && done.records_success === 100, JSON.stringify(done));
    const csv = await fetch(`${APP}/api/automation/runs/${r.data.run_id}/results`, { headers: { Authorization: `Bearer ${await token()}` } });
    const text = await csv.text();
    expect(text.split("\n").length === 101 && text.includes("priority") && text.includes("HIGH"), text.slice(0, 200));
  });
  await test("dashboard numbers come from the database", async () => {
    const d = await api<{ stats: Record<string, number> }>("GET", "/api/automation/dashboard");
    const [c] = await sql`select count(*) filter (where status = 'active')::int as active from automation_workflows`;
    expect(d.data.stats.active === c.active && d.data.stats.completed_today > 0, JSON.stringify(d.data.stats));
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log("Failed:\n" + failed.map((f) => ` - ${f.name}: ${f.detail}`).join("\n")); }
  shutdown();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); shutdown(); process.exit(1); });

// n8n integration. n8n orchestrates every run: the "Run Processor" loops
// step → wait/backoff → step until done; the "Ticker" fires every 5 minutes
// for schedules, sheet triggers, campaigns, monitors, social and reply checks;
// recurring workflow schedules get their own n8n workflow with a cron trigger.
import { randomUUID } from "node:crypto";
import { ActionError, providerFetch } from "../errors";
import { getIntegration, saveIntegration, setIntegrationStatus, useIntegration } from "../integrations";
import { appUrl } from "../env";
import { HttpError } from "../db";

type N8nNode = { id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: Record<string, unknown>; webhookId?: string; retryOnFail?: boolean; maxTries?: number; waitBetweenTries?: number };
type N8nWorkflow = { name: string; nodes: N8nNode[]; connections: Record<string, { main: { node: string; type: "main"; index: number }[][] }>; settings: Record<string, unknown> };

function engineSecret() {
  const s = process.env.ENGINE_SECRET;
  if (!s) throw new HttpError(503, "ENGINE_SECRET is not set on the server (any long random string).", "not_configured");
  return s;
}

function httpNode(name: string, path: string, body: string, pos: [number, number]): N8nNode {
  return {
    id: randomUUID(), name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: pos,
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      method: "POST", url: `${appUrl()}${path}`,
      sendHeaders: true, headerParameters: { parameters: [{ name: "x-engine-secret", value: engineSecret() }] },
      sendBody: true, specifyBody: "json", jsonBody: body,
      options: { timeout: 90000 },
    },
  };
}

export function processorWorkflow(path: string): N8nWorkflow {
  const hook: N8nNode = { id: randomUUID(), name: "Run requested", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: randomUUID(), parameters: { httpMethod: "POST", path, responseMode: "onReceived", options: {} } };
  const step = httpNode("Process step", "/api/engine/step", "={{ JSON.stringify({ run_id: $json.run_id || ($json.body && $json.body.run_id) }) }}", [260, 0]);
  const done: N8nNode = { id: randomUUID(), name: "Done?", type: "n8n-nodes-base.if", typeVersion: 1, position: [520, 0], parameters: { conditions: { boolean: [{ value1: "={{ ['done','paused'].includes($json.action) }}", value2: true }] } } };
  const end: N8nNode = { id: randomUUID(), name: "Finished", type: "n8n-nodes-base.noOp", typeVersion: 1, position: [780, -120], parameters: {} };
  const shouldWait: N8nNode = { id: randomUUID(), name: "Wait needed?", type: "n8n-nodes-base.if", typeVersion: 1, position: [780, 80], parameters: { conditions: { string: [{ value1: "={{ $json.action }}", value2: "wait" }] } } };
  const wait: N8nNode = { id: randomUUID(), name: "Backoff / delay", type: "n8n-nodes-base.wait", typeVersion: 1.1, position: [1040, 80], webhookId: randomUUID(), parameters: { resume: "timeInterval", amount: "={{ Math.max(1, $json.wait_seconds || 5) }}", unit: "seconds" } };
  return {
    name: "My Tools • Run Processor",
    nodes: [hook, step, done, end, shouldWait, wait],
    connections: {
      "Run requested": { main: [[{ node: "Process step", type: "main", index: 0 }]] },
      "Process step": { main: [[{ node: "Done?", type: "main", index: 0 }]] },
      "Done?": { main: [[{ node: "Finished", type: "main", index: 0 }], [{ node: "Wait needed?", type: "main", index: 0 }]] },
      "Wait needed?": { main: [[{ node: "Backoff / delay", type: "main", index: 0 }], [{ node: "Process step", type: "main", index: 0 }]] },
      "Backoff / delay": { main: [[{ node: "Process step", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "all" },
  };
}

export function tickerWorkflow(): N8nWorkflow {
  const trig: N8nNode = { id: randomUUID(), name: "Every 5 minutes", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } } };
  const tick = httpNode("Engine tick", "/api/engine/tick", "={{ JSON.stringify({ source: 'n8n' }) }}", [260, 0]);
  return { name: "My Tools • Scheduler Tick", nodes: [trig, tick], connections: { "Every 5 minutes": { main: [[{ node: "Engine tick", type: "main", index: 0 }]] } }, settings: { executionOrder: "v1", saveDataSuccessExecution: "none" } };
}

export function scheduleWorkflow(name: string, cron: string, timezone: string, workflowId: string, scheduleId: string): N8nWorkflow {
  const trig: N8nNode = { id: randomUUID(), name: "Schedule", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [{ field: "cronExpression", expression: cron }] } } };
  const call = httpNode("Start run", "/api/engine/trigger", `={{ JSON.stringify({ workflow_id: '${workflowId}', schedule_id: '${scheduleId}', fired_at: $now.toISO() }) }}`, [260, 0]);
  return { name: `My Tools • ${name}`.slice(0, 120), nodes: [trig, call], connections: { Schedule: { main: [[{ node: "Start run", type: "main", index: 0 }]] } }, settings: { executionOrder: "v1", timezone, saveDataSuccessExecution: "none" } };
}

async function api(ws: string) {
  const i = await useIntegration(ws, "n8n");
  if (!i.secrets.api_key) throw new ActionError({ service: "n8n", message: "n8n API key not set", retryable: false, recommendedAction: "Add an n8n API key in Settings → Integrations → n8n." });
  const base = i.config.base_url.replace(/\/$/, "");
  const call = (method: string, path: string, body?: unknown) => providerFetch("n8n", `${base}/api/v1${path}`, { method, headers: { "X-N8N-API-KEY": i.secrets.api_key, "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.data as Record<string, unknown>);
  return { base, call, integration: i };
}

export async function n8nApiAvailable(ws: string) {
  const i = await getIntegration(ws, "n8n");
  return !!(i && i.status === "connected" && i.secrets.api_key);
}

export async function testN8n(c: Record<string, string>, s: Record<string, string>) {
  const base = (c.base_url || "").replace(/\/$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("n8n URL must start with https://");
  if (s.api_key) {
    const { data } = await providerFetch("n8n", `${base}/api/v1/workflows?limit=50`, { headers: { "X-N8N-API-KEY": s.api_key, Accept: "application/json" } });
    const list = (data as { data?: { name: string; active: boolean }[] }).data || [];
    const engine = list.filter((w) => w.name.startsWith("My Tools •"));
    return `n8n API OK — ${list.length} workflows${engine.length ? `, engine: ${engine.map((w) => `${w.name.replace("My Tools • ", "")}${w.active ? " ✓" : " (inactive)"}`).join(", ")}` : ", engine not installed yet"}`;
  }
  const { status } = await providerFetch("n8n", `${base}/healthz`);
  if (!c.run_webhook_url) throw new Error(`n8n reachable (${status}) but no API key and no Run Processor webhook URL — add one of them.`);
  return `n8n reachable (healthz ${status}); using manual Run Processor webhook`;
}

/** Create (or update) and activate the engine workflows in n8n. */
export async function installEngine(ws: string) {
  const { base, call, integration } = await api(ws);
  const path = `mytools-run-${ws.slice(0, 8)}`;
  const existing = ((await call("GET", "/workflows?limit=250")).data as { id: string; name: string }[]) || [];
  const upsert = async (wf: N8nWorkflow) => {
    const found = existing.find((w) => w.name === wf.name);
    const id = found ? (await call("PUT", `/workflows/${found.id}`, wf)).id as string : (await call("POST", "/workflows", wf)).id as string;
    await call("POST", `/workflows/${id}/activate`);
    return id;
  };
  const processorId = await upsert(processorWorkflow(path));
  const tickerId = await upsert(tickerWorkflow());
  const runUrl = `${base}/webhook/${path}`;
  await saveIntegration(ws, "n8n", { run_webhook_url: runUrl, _processor_id: processorId, _ticker_id: tickerId } as Record<string, string>, { status: "connected" });
  await setIntegrationStatus(ws, "n8n", "connected", null);
  void integration;
  return { processorId, tickerId, runWebhookUrl: runUrl };
}

export async function upsertScheduleWorkflow(ws: string, existingId: string | null, wf: N8nWorkflow): Promise<string> {
  const { call } = await api(ws);
  let id = existingId;
  if (id) {
    try { await call("PUT", `/workflows/${id}`, wf); } catch (e) { if ((e as ActionError).httpStatus === 404) id = null; else throw e; }
  }
  if (!id) id = (await call("POST", "/workflows", wf)).id as string;
  await call("POST", `/workflows/${id}/activate`);
  return id;
}

export async function setN8nWorkflowActive(ws: string, id: string, active: boolean) {
  const { call } = await api(ws);
  await call("POST", `/workflows/${id}/${active ? "activate" : "deactivate"}`).catch((e: ActionError) => { if (e.httpStatus !== 404) throw e; });
}

export async function deleteN8nWorkflow(ws: string, id: string) {
  const { call } = await api(ws);
  await call("DELETE", `/workflows/${id}`).catch((e: ActionError) => { if (e.httpStatus !== 404) throw e; });
}

/** Engine workflows with this server's URL + secret filled in (for manual import). */
export function engineExport(ws: string) {
  return [processorWorkflow(`mytools-run-${ws.slice(0, 8)}`), tickerWorkflow()];
}

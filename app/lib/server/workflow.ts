// Workflow engine: runs steps in order with {{template}} data passing.
import { getPath, renderTemplate } from "../csv";
import type { RunLog, Secrets, Step, Workflow } from "../workflow-types";
import { runAI, extractJSON, type Provider } from "./ai";
import { auditUrl } from "./audit";
import { httpCall, sendEmail, sendWhatsApp, sheetsWebhook, wpRequest } from "./channels";
import { fetchPage } from "./fetch-page";

type Ctx = { input: unknown; vars: Record<string, unknown>; steps: Record<string, unknown>; now: string };

function parseMaybeJSON(s: string): unknown {
  if (!s?.trim()) return undefined;
  try { return JSON.parse(s); } catch { return s; }
}

/** Render a JSON template so inserted values are JSON-escaped correctly. */
function renderJSON(tpl: string, ctx: Ctx): unknown {
  if (!tpl?.trim()) return undefined;
  const rendered = tpl.replace(/\{\{\s*([\w.\- ]+?)\s*\}\}/g, (_, p: string) => {
    const v = getPath(ctx, p.trim());
    if (v != null && typeof v === "object") return JSON.stringify(v); // use unquoted: "row": {{steps.x}}
    return JSON.stringify(v == null ? "" : String(v)).slice(1, -1); // escaped for use inside "quotes"
  });
  return parseMaybeJSON(rendered);
}

function compare(left: unknown, op: string, right: string): boolean {
  const l = left == null ? "" : String(left);
  switch (op) {
    case "equals": return l.toLowerCase() === right.toLowerCase();
    case "not_equals": return l.toLowerCase() !== right.toLowerCase();
    case "contains": return l.toLowerCase().includes(right.toLowerCase());
    case "gt": return parseFloat(l) > parseFloat(right);
    case "lt": return parseFloat(l) < parseFloat(right);
    case "exists": return l.trim() !== "";
    case "not_exists": return l.trim() === "";
    default: return false;
  }
}

const key = (s: Step) => (s.name || s.id).replace(/[^\w-]/g, "_");

async function runStep(step: Step, ctx: Ctx, sec: Secrets): Promise<unknown> {
  const c = step.config || {};
  const t = (v: string) => renderTemplate(v || "", ctx);
  switch (step.type) {
    case "ai": {
      const text = await runAI({ provider: (sec.aiProvider as Provider) || "groq", apiKey: sec.aiKey, prompt: t(c.prompt), json: c.json === "json" });
      return c.json === "json" ? extractJSON(text) : text;
    }
    case "set": { const v = t(c.value); ctx.vars[c.key || "value"] = parseMaybeJSON(v) ?? v; return v; }
    case "condition": {
      const raw = c.left?.includes("{{") ? getPath(ctx, c.left.replace(/[{}\s]/g, "")) ?? t(c.left) : c.left;
      return compare(raw, c.op || "equals", t(c.right || ""));
    }
    case "http": return httpCall(t(c.url), c.method || "POST", renderJSON(c.body, ctx) ?? t(c.body), (renderJSON(c.headers, ctx) as Record<string, string>) || undefined);
    case "email": return { id: await sendEmail({ apiKey: sec.resendKey, from: sec.emailFrom, to: t(c.to), subject: t(c.subject), text: t(c.body) }) };
    case "whatsapp": return { id: await sendWhatsApp({ token: sec.waToken, phoneId: sec.waPhoneId, to: t(c.to), text: t(c.text), template: c.template ? { name: t(c.template), params: t(c.params).split(",").map((x) => x.trim()).filter(Boolean) } : undefined }) };
    case "wordpress": {
      const kind = c.action === "create_page" ? "pages" : "posts";
      const payload: Record<string, unknown> = { title: t(c.title), content: t(c.content), status: c.status || "draft" };
      if (c.date) payload.date = t(c.date);
      const meta = renderJSON(c.meta, ctx);
      if (meta && typeof meta === "object") payload.meta = meta;
      if (c.action === "update_post") {
        for (const k of Object.keys(payload)) if (payload[k] === "") delete payload[k];
        return wpRequest(sec, "POST", `/wp-json/wp/v2/posts/${t(c.postId)}`, undefined, payload);
      }
      const r = (await wpRequest(sec, "POST", `/wp-json/wp/v2/${kind}`, undefined, payload)) as { id: number; link: string; status: string };
      return { id: r.id, link: r.link, status: r.status };
    }
    case "sheets": return sheetsWebhook(sec.sheetsWebhook, { action: c.action || "append", sheet: t(c.sheet) || "Sheet1", row: renderJSON(c.row, ctx), matchColumn: t(c.matchColumn) });
    case "audit": return auditUrl(t(c.url), false);
    case "monitor": { const p = await fetchPage(t(c.url)); return { up: p.ok, status: p.status, ms: p.ms, error: p.error, title: p.html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() || "" }; }
  }
}

export async function runWorkflow(wf: Pick<Workflow, "steps" | "name">, input: unknown, secrets: Secrets): Promise<{ ok: boolean; log: RunLog[]; ctx: Ctx }> {
  const ctx: Ctx = { input, vars: {}, steps: {}, now: new Date().toISOString() };
  const log: RunLog[] = [{ step: "Trigger", type: "trigger", ok: true, output: input, ms: 0 }];
  let skipNext = false;
  for (const step of wf.steps) {
    if (skipNext) { skipNext = false; log.push({ step: step.name, type: step.type, ok: true, skipped: true, ms: 0 }); continue; }
    const started = Date.now();
    try {
      const out = await runStep(step, ctx, secrets);
      ctx.steps[key(step)] = out;
      log.push({ step: step.name, type: step.type, ok: true, output: out, ms: Date.now() - started });
      if (step.type === "condition" && !out) {
        if (step.config.onFalse === "skip_next") skipNext = true;
        else { log.push({ step: "Stopped", type: "condition", ok: true, output: "Condition false — workflow stopped", ms: 0 }); break; }
      }
    } catch (e) {
      log.push({ step: step.name, type: step.type, ok: false, error: (e as Error).message, ms: Date.now() - started });
      return { ok: false, log, ctx };
    }
  }
  return { ok: true, log, ctx };
}

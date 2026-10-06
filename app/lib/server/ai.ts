// Server-side AI router. Every tool calls AI through /api/ai (never straight
// from the browser) so provider CORS rules don't matter and keys can also come
// from Vercel environment variables.
import Anthropic from "@anthropic-ai/sdk";
import { ActionError, externalUrl, toActionError } from "./errors";

export type Provider = "claude" | "gpt" | "gemini" | "groq";

export type AIRequest = {
  provider: Provider;
  apiKey?: string;
  model?: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  json?: boolean;
};

export type AIUsage = { provider: string; model: string; input_tokens: number; output_tokens: number };

const ENV_KEYS: Record<Provider, string | undefined> = {
  claude: process.env.ANTHROPIC_API_KEY,
  gpt: process.env.OPENAI_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
  groq: process.env.GROQ_API_KEY,
};

const KEY_HELP: Record<Provider, string> = {
  claude: "Add a Claude key (console.anthropic.com) in ⚙ Settings or set ANTHROPIC_API_KEY.",
  gpt: "Add an OpenAI key in ⚙ Settings or set OPENAI_API_KEY.",
  gemini: "Add a free Gemini key (aistudio.google.com) in ⚙ Settings or set GEMINI_API_KEY.",
  groq: "Add a free Groq key (console.groq.com) in ⚙ Settings or set GROQ_API_KEY.",
};

export async function runAI(req: AIRequest): Promise<string> {
  return (await runAIWithUsage(req)).text;
}

export async function runAIWithUsage(req: AIRequest): Promise<{ text: string; usage: AIUsage }> {
  const provider = req.provider || "groq";
  const key = req.apiKey || ENV_KEYS[provider];
  if (!key) throw new Error(`No ${provider} API key. ${KEY_HELP[provider]}`);
  const system = (req.system || "You are a helpful assistant for an Indian digital agency.") +
    (req.json ? "\nRespond with valid JSON only — no markdown fences, no commentary." : "");
  const maxTokens = req.maxTokens || 4000;

  if (provider === "claude") {
    const client = new Anthropic({ apiKey: key });
    const model = req.model || "claude-opus-5-5";
    const res = await client.beta.messages.create({
      model,
      max_tokens: Math.max(maxTokens, 8000),
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: req.prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("Claude declined this request.");
    return { text: res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim(), usage: { provider, model: res.model || model, input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0 } };
  }

  if (provider === "gemini") {
    const gmodel = req.model || "gemini-2.5-flash";
    const r = await fetch(
      externalUrl(`https://generativelanguage.googleapis.com/v1beta/models/${gmodel}:generateContent?key=${encodeURIComponent(key)}`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            ...(req.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      },
    );
    const data = await r.json();
    if (!r.ok || data.error) throw new ActionError({ service: "ai", message: data.error?.message || `Gemini error ${r.status}`, httpStatus: r.status, providerResponse: data });
    return { text: (data.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("").trim(), usage: { provider, model: gmodel, input_tokens: data.usageMetadata?.promptTokenCount ?? 0, output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0 } };
  }

  // OpenAI and Groq share the chat-completions format.
  const url = provider === "gpt"
    ? "https://api.openai.com/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions";
  const model = req.model || (provider === "gpt" ? "gpt-4o" : "llama-3.3-70b-versatile");
  const r = await fetch(externalUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: system }, { role: "user", content: req.prompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new ActionError({ service: "ai", message: data.error?.message || `${provider} error ${r.status}`, httpStatus: r.status, providerResponse: data });
  return { text: (data.choices?.[0]?.message?.content || "").trim(), usage: { provider, model, input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 } };
}

/** Pull the first JSON object/array out of a model reply. */
export function extractJSON<T = unknown>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
  throw new Error("AI did not return valid JSON");
}

// ── Workspace AI (key from Settings → Integrations, never from the browser) ──
import { useIntegration } from "./integrations";
import { integrationGate } from "./ratelimit";
import type { OutField } from "../automation/types";

export async function workspaceAI(ws: string, prompt: string, opts: { system?: string; json?: boolean; maxTokens?: number } = {}) {
  const i = await useIntegration(ws, "ai");
  await integrationGate(ws, "ai", Number(i.config.rate_per_minute) || undefined);
  try {
    return await runAIWithUsage({ provider: (i.config.provider as Provider) || "groq", model: i.config.model || undefined, apiKey: i.secrets.api_key, prompt, ...opts });
  } catch (e) {
    const ae = e instanceof ActionError ? e : toActionError(e, "ai");
    const status = (e as { status?: number }).status; // Anthropic SDK errors
    if (status && !ae.httpStatus) { ae.httpStatus = status; ae.retryable = status === 429 || status >= 500; }
    throw ae;
  }
}

export function validateOutput(obj: unknown, fields: OutField[]): { ok: boolean; value: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const value: Record<string, unknown> = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, value, errors: ["Output is not a JSON object"] };
  const o = obj as Record<string, unknown>;
  for (const f of fields) {
    const v = o[f.name];
    if (v === undefined || v === null || v === "") { errors.push(`Missing "${f.name}"`); continue; }
    if (f.type === "number") {
      const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
      if (!Number.isFinite(n)) errors.push(`"${f.name}" must be a number`); else value[f.name] = n;
    } else if (f.type === "boolean") {
      if (typeof v === "boolean") value[f.name] = v; else if (/^(true|yes)$/i.test(String(v))) value[f.name] = true; else if (/^(false|no)$/i.test(String(v))) value[f.name] = false; else errors.push(`"${f.name}" must be true/false`);
    } else if (f.type === "enum") {
      const hit = f.options?.find((x) => x.toLowerCase() === String(v).toLowerCase());
      if (!hit) errors.push(`"${f.name}" must be one of ${f.options?.join(", ")}`); else value[f.name] = hit;
    } else if (f.type === "array") {
      value[f.name] = Array.isArray(v) ? v : String(v).split(/[;,]/).map((x) => x.trim()).filter(Boolean);
    } else value[f.name] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return { ok: errors.length === 0, value, errors };
}

/** Structured AI: generate → validate → repair once → validate → fail. */
export async function aiStructured(ws: string, instruction: string, record: unknown, fields: OutField[]) {
  const schema = fields.map((f) => `"${f.name}": ${f.type === "enum" ? `one of ${f.options?.map((x) => JSON.stringify(x)).join("|")}` : f.type}`).join(", ");
  const usage: AIUsage[] = [];
  const first = await workspaceAI(ws, `${instruction}\n\nReturn ONLY a JSON object with exactly these fields: {${schema}}.\nUse only the data provided; if something is unknown say "unknown" rather than inventing facts.\n\nRecord:\n${JSON.stringify(record)}`, { json: true, maxTokens: 1500 });
  usage.push(first.usage);
  let parsed: unknown = null;
  try { parsed = extractJSON(first.text); } catch { parsed = null; }
  let v = validateOutput(parsed, fields);
  let repaired = false;
  if (!v.ok) {
    repaired = true;
    const second = await workspaceAI(ws, `Your previous answer was invalid: ${v.errors.join("; ")}.\nPrevious answer:\n${first.text.slice(0, 3000)}\n\nReturn ONLY a corrected JSON object with exactly these fields: {${schema}}.\nRecord:\n${JSON.stringify(record)}`, { json: true, maxTokens: 1500 });
    usage.push(second.usage);
    try { parsed = extractJSON(second.text); } catch { parsed = null; }
    v = validateOutput(parsed, fields);
  }
  if (!v.ok) throw new ActionError({ service: "ai", message: `AI output failed validation after repair: ${v.errors.join("; ")}`, retryable: false, providerResponse: parsed, recommendedAction: "Simplify the instruction or output fields, or try a stronger model." });
  return { value: v.value, usage, repaired };
}

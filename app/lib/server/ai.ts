// Server-side AI router. Every tool calls AI through /api/ai (never straight
// from the browser) so provider CORS rules don't matter and keys can also come
// from Vercel environment variables.
import Anthropic from "@anthropic-ai/sdk";

export type Provider = "claude" | "gpt" | "gemini" | "groq";

export type AIRequest = {
  provider: Provider;
  apiKey?: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  json?: boolean;
};

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
  const provider = req.provider || "groq";
  const key = req.apiKey || ENV_KEYS[provider];
  if (!key) throw new Error(`No ${provider} API key. ${KEY_HELP[provider]}`);
  const system = (req.system || "You are a helpful assistant for an Indian digital agency.") +
    (req.json ? "\nRespond with valid JSON only — no markdown fences, no commentary." : "");
  const maxTokens = req.maxTokens || 4000;

  if (provider === "claude") {
    const client = new Anthropic({ apiKey: key });
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: Math.max(maxTokens, 8000),
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: req.prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("Claude declined this request.");
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  }

  if (provider === "gemini") {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
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
    if (!r.ok || data.error) throw new Error(data.error?.message || `Gemini error ${r.status}`);
    return (data.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("").trim();
  }

  // OpenAI and Groq share the chat-completions format.
  const url = provider === "gpt"
    ? "https://api.openai.com/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions";
  const model = provider === "gpt" ? "gpt-4o" : "llama-3.3-70b-versatile";
  const r = await fetch(url, {
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
  if (!r.ok || data.error) throw new Error(data.error?.message || `${provider} error ${r.status}`);
  return (data.choices?.[0]?.message?.content || "").trim();
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

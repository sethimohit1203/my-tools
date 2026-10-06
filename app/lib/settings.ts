"use client";
// One settings object shared by every tool (stored in this browser only).
import { readStored, useStored } from "./store";

export type Provider = "claude" | "gpt" | "gemini" | "groq";

export type Settings = {
  aiProvider: Provider;
  claudeKey: string;
  oaiKey: string;
  gemKey: string;
  groqKey: string;
  googlePlacesKey: string;
  resendKey: string;
  emailFrom: string;
  waToken: string;
  waPhoneId: string;
  sheetsWebhook: string;
  socialWebhook: string;
  wpUrl: string;
  wpUser: string;
  wpPass: string;
  agencyName: string;
  agencyPhone: string;
  agencyEmail: string;
  agencyWebsite: string;
};

export const DEFAULT_SETTINGS: Settings = {
  aiProvider: "groq", claudeKey: "", oaiKey: "", gemKey: "", groqKey: "",
  googlePlacesKey: "", resendKey: "", emailFrom: "", waToken: "", waPhoneId: "",
  sheetsWebhook: "", socialWebhook: "", wpUrl: "", wpUser: "", wpPass: "",
  agencyName: "Designoia", agencyPhone: "", agencyEmail: "", agencyWebsite: "",
};

export const SETTINGS_KEY = "tools-settings";

/** Merge in keys saved by the older per-tool settings (WP AI tool, Maps). */
function withLegacy(s: Settings): Settings {
  const wp = readStored<Partial<{ wpUrl: string; wpUser: string; wpPass: string; claudeKey: string; oaiKey: string; gemKey: string; groqKey: string; model: Provider }>>("wp-ai-config", {});
  let gkey = "";
  try { gkey = typeof window !== "undefined" ? localStorage.getItem("gmaps-api-key") || "" : ""; } catch { /* ignore */ }
  return {
    ...s,
    claudeKey: s.claudeKey || wp.claudeKey || "",
    oaiKey: s.oaiKey || wp.oaiKey || "",
    gemKey: s.gemKey || wp.gemKey || "",
    groqKey: s.groqKey || wp.groqKey || "",
    wpUrl: s.wpUrl || wp.wpUrl || "",
    wpUser: s.wpUser || wp.wpUser || "",
    wpPass: s.wpPass || wp.wpPass || "",
    googlePlacesKey: s.googlePlacesKey || gkey.replace(/^"|"$/g, ""),
  };
}

export function getSettings(): Settings {
  return withLegacy({ ...DEFAULT_SETTINGS, ...readStored<Partial<Settings>>(SETTINGS_KEY, {}) });
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [raw, setRaw] = useStored<Partial<Settings>>(SETTINGS_KEY, {});
  const merged = withLegacy({ ...DEFAULT_SETTINGS, ...raw });
  return [merged, (patch) => setRaw((p) => ({ ...p, ...patch }))];
}

export function aiKeyFor(s: Settings, p: Provider = s.aiProvider) {
  return p === "claude" ? s.claudeKey : p === "gpt" ? s.oaiKey : p === "gemini" ? s.gemKey : s.groqKey;
}

/** The secrets a server-side step may need, taken from settings. */
export function secretsFrom(s: Settings) {
  return {
    aiProvider: s.aiProvider, aiKey: aiKeyFor(s),
    resendKey: s.resendKey, emailFrom: s.emailFrom,
    waToken: s.waToken, waPhoneId: s.waPhoneId,
    sheetsWebhook: s.sheetsWebhook,
    wpUrl: s.wpUrl, wpUser: s.wpUser, wpPass: s.wpPass,
  };
}

export async function api<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data: Record<string, unknown>;
  try { data = await res.json(); } catch { throw new Error(`Request to ${path} failed (${res.status})`); }
  if (!res.ok || data.error) throw new Error(String(data.error || `Request failed (${res.status})`));
  return data as T;
}

export async function aiText(prompt: string, opts: { system?: string; maxTokens?: number } = {}): Promise<string> {
  const s = getSettings();
  const data = await api<{ text: string }>("/api/ai", { provider: s.aiProvider, apiKey: aiKeyFor(s), prompt, ...opts });
  return data.text;
}

export async function aiJSON<T = unknown>(prompt: string, opts: { system?: string; maxTokens?: number } = {}): Promise<T> {
  const s = getSettings();
  const data = await api<{ data: T }>("/api/ai", { provider: s.aiProvider, apiKey: aiKeyFor(s), prompt, json: true, ...opts });
  return data.data;
}

export function hasAI(s: Settings) {
  return !!aiKeyFor(s);
}

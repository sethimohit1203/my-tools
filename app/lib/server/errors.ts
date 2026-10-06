// Structured action errors: every failure records service, step, provider
// response, whether it can be retried, and what the user should do.

export class ActionError extends Error {
  service: string;
  httpStatus?: number;
  providerResponse?: unknown;
  retryable: boolean;
  recommendedAction?: string;
  retryAfterSec?: number;
  code?: string;
  constructor(o: { service: string; message: string; httpStatus?: number; providerResponse?: unknown; retryable?: boolean; recommendedAction?: string; retryAfterSec?: number; code?: string }) {
    super(o.message);
    this.service = o.service;
    this.httpStatus = o.httpStatus;
    this.providerResponse = o.providerResponse;
    this.retryable = o.retryable ?? (o.httpStatus ? isRetryableStatus(o.httpStatus) : false);
    this.recommendedAction = o.recommendedAction ?? recommend(o.service, o.httpStatus);
    this.retryAfterSec = o.retryAfterSec;
    this.code = o.code;
  }
}

export function isRetryableStatus(s: number) {
  return s === 408 || s === 425 || s === 429 || s >= 500;
}

function recommend(service: string, status?: number) {
  if (status === 401) return `Reconnect the ${service} integration (credentials rejected).`;
  if (status === 403) return `Check ${service} permissions/scopes for this account.`;
  if (status === 404) return "Check the ID/URL used in this step.";
  if (status === 429) return "Rate limited by the provider — will retry automatically; lower the workflow rate if it persists.";
  if (status && status >= 500) return `${service} is having problems — will retry automatically.`;
  if (status && status >= 400) return "Fix the input data or step configuration.";
  return undefined;
}

export function integrationRequired(service: string, what?: string) {
  return new ActionError({ service, message: `Integration Required: ${what || service} is not configured`, retryable: false, recommendedAction: `Configure ${what || service} in Settings → Integrations.`, code: "integration_required" });
}

/** Turn any thrown value into an ActionError (network errors are retryable). */
export function toActionError(e: unknown, service = "app"): ActionError {
  if (e instanceof ActionError) return e;
  const err = e as Error & { code?: string; cause?: { code?: string } };
  const code = err?.cause?.code || err?.code || "";
  const network = err?.name === "AbortError" || err?.name === "TimeoutError" || /ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR|socket hang up|fetch failed/i.test(code + " " + err?.message);
  return new ActionError({ service, message: err?.message || String(e), retryable: network, recommendedAction: network ? "Temporary network problem — will retry automatically." : undefined });
}

/** fetch() that throws ActionError on non-2xx with the provider's response. */
export async function providerFetch(service: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ status: number; data: unknown; headers: Headers }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30000);
  let res: Response;
  try {
    res = await fetch(externalUrl(url), { ...init, signal: ctrl.signal, cache: "no-store" });
  } catch (e) {
    throw toActionError(e, service);
  } finally { clearTimeout(t); }
  const text = await res.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!res.ok) {
    const d = data as { error?: { message?: string; error_user_msg?: string } | string; message?: string };
    const msg = (typeof d?.error === "object" ? d.error?.error_user_msg || d.error?.message : d?.error) || d?.message || (typeof data === "string" ? data.slice(0, 300) : "") || res.statusText;
    const ra = Number(res.headers.get("retry-after"));
    throw new ActionError({ service, message: `${service} HTTP ${res.status}: ${msg}`, httpStatus: res.status, providerResponse: data, retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : undefined });
  }
  return { status: res.status, data, headers: res.headers };
}

/** Test hook: EXTERNAL_API_OVERRIDE=http://127.0.0.1:9999 routes https://host/path → override/host/path. */
export function externalUrl(url: string) {
  const o = process.env.EXTERNAL_API_OVERRIDE;
  if (!o || !/^https:\/\//.test(url)) return url;
  const u = new URL(url);
  return `${o.replace(/\/$/, "")}/${u.host}${u.pathname}${u.search}`;
}

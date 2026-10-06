import { db } from "./db";
import { ActionError } from "./errors";

/** Fixed-window limiter stored in Postgres (works across serverless instances). */
export async function hitRateLimit(key: string, windowSec: number, max: number): Promise<boolean> {
  const [r] = await db()`select hit_rate_limit(${key}, ${windowSec}, ${max}) as ok`;
  return !!r.ok;
}

/** Per-integration limits (requests per minute) — conservative defaults. */
const PER_MIN: Record<string, number> = { whatsapp: 60, gmail: 40, smtp: 30, resend: 100, google_sheets: 50, wordpress: 60, ai: 30, facebook: 30, instagram: 20, linkedin: 20, http: 120, social_webhook: 60, google_places: 60 };

export async function integrationGate(ws: string, service: string, override?: number) {
  const max = override && override > 0 ? override : PER_MIN[service] ?? 60;
  if (!(await hitRateLimit(`int:${ws}:${service}`, 60, max))) {
    throw new ActionError({ service, message: `Rate limit reached for ${service} (${max}/min)`, retryable: true, retryAfterSec: 60, code: "self_rate_limited", recommendedAction: "Will continue automatically in the next minute." });
  }
}

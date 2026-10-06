import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { decrypt } from "@/app/lib/server/crypto";
import { regenerateSecret } from "@/app/lib/server/webhooks";

export const POST = authed(async (req, a, p) => {
  const sql = db();
  if (p.action === "disable" || p.action === "enable") {
    const [r] = await sql`update webhook_endpoints set status = ${p.action === "enable" ? "active" : "disabled"}, updated_at = now() where id = ${p.id} and workspace_id = ${a.workspaceId} returning id`;
    if (!r) throw new HttpError(404, "Webhook not found");
    return { ok: true };
  }
  if (p.action === "regenerate") return regenerateSecret(a.workspaceId, p.id);
  if (p.action === "reveal") {
    const [r] = await sql`select secret_enc from webhook_endpoints where id = ${p.id} and workspace_id = ${a.workspaceId}`;
    if (!r) throw new HttpError(404, "Webhook not found");
    return { secret: decrypt<{ secret: string }>(r.secret_enc as string)!.secret };
  }
  if (p.action === "settings") {
    const b = await body<{ name?: string; method?: string; auth_mode?: string; rate_limit_per_min?: number; max_body_kb?: number }>(req);
    await sql`update webhook_endpoints set name = coalesce(${b.name ?? null}, name), method = coalesce(${b.method ?? null}, method), auth_mode = coalesce(${b.auth_mode ?? null}, auth_mode), rate_limit_per_min = coalesce(${b.rate_limit_per_min ?? null}, rate_limit_per_min), max_body_kb = coalesce(${b.max_body_kb ?? null}, max_body_kb), updated_at = now() where id = ${p.id} and workspace_id = ${a.workspaceId}`;
    return { ok: true };
  }
  throw new HttpError(404, "Unknown action");
});

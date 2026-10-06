import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { campaignStats } from "@/app/lib/server/campaigns";

export const GET = authed(async (req, a, p) => {
  const sql = db();
  const [c] = await sql`select * from campaigns where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  if (!c) throw new HttpError(404, "Campaign not found");
  const status = req.nextUrl.searchParams.get("status");
  const messages = await sql`select m.id, m.step_index, m.to_address, m.status, m.provider, m.provider_message_id, m.error, m.scheduled_for, m.sent_at, m.delivered_at, m.read_at, m.replied_at, m.attempts, m.run_id, l.name as lead_name, l.id as lead_id, cl.status as lead_status
    from campaign_messages m join leads l on l.id = m.lead_id join campaign_leads cl on cl.id = m.campaign_lead_id where m.campaign_id = ${p.id} ${status ? sql`and m.status = ${status}` : sql``} order by m.scheduled_for desc limit 500`;
  return { campaign: c, stats: await campaignStats(a.workspaceId, p.id), messages };
});

export const PUT = authed(async (req, a, p) => {
  const b = await body<{ name?: string; mode?: string; audience_filter?: unknown; steps?: unknown; settings?: unknown }>(req);
  const sql = db();
  const [c] = await sql`select status from campaigns where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  if (!c) throw new HttpError(404, "Campaign not found");
  if (c.status !== "draft" && (b.audience_filter || b.mode)) throw new HttpError(409, "Audience and mode can only change while the campaign is a draft");
  await sql`update campaigns set name = coalesce(${b.name ?? null}, name), mode = coalesce(${b.mode ?? null}, mode),
    audience_filter = ${b.audience_filter ? sql.json(b.audience_filter as never) : sql`audience_filter`}, steps = ${b.steps ? sql.json(b.steps as never) : sql`steps`}, settings = ${b.settings ? sql.json(b.settings as never) : sql`settings`}, updated_at = now() where id = ${p.id}`;
  return { ok: true };
});

export const DELETE = authed(async (_req, a, p) => {
  const [c] = await db()`select status from campaigns where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  if (c?.status === "active") throw new HttpError(409, "Pause or cancel the campaign before deleting it");
  await db()`delete from campaigns where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  return { ok: true };
});

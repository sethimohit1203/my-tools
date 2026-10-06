import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";

export const GET = authed(async (req, a) => {
  const ch = req.nextUrl.searchParams.get("channel");
  const sql = db();
  const rows = await sql`select c.*,
      (select count(*)::int from campaign_leads cl where cl.campaign_id = c.id) as leads,
      (select count(*)::int from campaign_messages m where m.campaign_id = c.id and m.status in ('sent','delivered','read','replied')) as sent,
      (select count(*)::int from campaign_messages m where m.campaign_id = c.id and m.status = 'queued') as queued,
      (select count(*)::int from campaign_messages m where m.campaign_id = c.id and m.status = 'failed') as failed,
      (select count(*)::int from campaign_leads cl where cl.campaign_id = c.id and cl.status = 'replied') as replied
    from campaigns c where c.workspace_id = ${a.workspaceId} ${ch ? sql`and c.channel = ${ch}` : sql``} order by c.created_at desc`;
  return { campaigns: rows };
});

export const POST = authed(async (req, a) => {
  const b = await body<{ name: string; channel: string; mode?: string; audience_filter?: unknown; steps?: unknown; settings?: unknown }>(req);
  if (!["email", "whatsapp"].includes(b.channel)) throw new HttpError(400, "Channel must be email or whatsapp");
  const sql = db();
  const [c] = await sql`insert into campaigns (workspace_id, name, channel, mode, audience_filter, steps, settings) values (${a.workspaceId}, ${b.name || "New campaign"}, ${b.channel}, ${b.mode === "manual" ? "manual" : "api"}, ${sql.json((b.audience_filter || {}) as never)}, ${sql.json((b.steps || []) as never)}, ${sql.json((b.settings || {}) as never)}) returning *`;
  return { campaign: c };
});

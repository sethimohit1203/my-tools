import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { logLeadActivity, updateLead } from "@/app/lib/server/leads-db";

export const GET = authed(async (_req, a, p) => {
  const [lead] = await db()`select * from leads where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  if (!lead) throw new HttpError(404, "Lead not found");
  const activities = await db()`select * from lead_activities where lead_id = ${p.id} order by created_at desc limit 100`;
  const messages = await db()`select m.id, m.channel, m.step_index, m.status, m.sent_at, m.error, c.name as campaign from campaign_messages m join campaigns c on c.id = m.campaign_id where m.lead_id = ${p.id} order by m.created_at desc limit 50`;
  return { lead, activities, messages };
});

export const PATCH = authed(async (req, a, p) => {
  const b = await body<Record<string, unknown> & { _activity?: { channel: string; text: string } }>(req);
  const { _activity, ...patch } = b;
  await updateLead(a.workspaceId, p.id, patch);
  if (_activity?.text) {
    await logLeadActivity(a.workspaceId, p.id, _activity.channel || "Note", _activity.text);
    if (["Call", "WhatsApp", "Email"].includes(_activity.channel)) await db()`update leads set last_contacted_at = now() where id = ${p.id}`;
  }
  return { ok: true };
});

export const DELETE = authed(async (_req, a, p) => { await db()`delete from leads where id = ${p.id} and workspace_id = ${a.workspaceId}`; return { ok: true }; });

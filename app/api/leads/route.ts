import { authed, body } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { upsertLead } from "@/app/lib/server/leads-db";
import { emitEvent } from "@/app/lib/server/engine/triggers";

export const GET = authed(async (req, a) => {
  const q = req.nextUrl.searchParams;
  const sql = db();
  const s = q.get("q"), stage = q.get("stage"), profile = q.get("profile"), temp = q.get("temperature");
  const leads = await sql`select * from leads where workspace_id = ${a.workspaceId}
    ${s ? sql`and (name ilike ${"%" + s + "%"} or coalesce(category,'') ilike ${"%" + s + "%"} or coalesce(address,'') ilike ${"%" + s + "%"} or coalesce(notes,'') ilike ${"%" + s + "%"})` : sql``}
    ${stage ? sql`and stage = ${stage}` : sql``} ${profile ? sql`and profile = ${profile}` : sql``} ${temp ? sql`and temperature = ${temp}` : sql``}
    order by updated_at desc limit ${Math.min(Number(q.get("limit") || 1000), 5000)}`;
  return { leads };
});

export const POST = authed(async (req, a) => {
  const b = await body<Record<string, unknown>>(req);
  const r = await upsertLead(a.workspaceId, { source: "manual", ...b });
  if (r.created) await emitEvent(a.workspaceId, "new_lead", { ...b, lead_id: r.id });
  return r;
});

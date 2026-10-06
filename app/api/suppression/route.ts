import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { normalizePhone } from "@/app/lib/server/whatsapp";

export const GET = authed(async (_req, a) => ({ entries: await db()`select * from suppression_list where workspace_id = ${a.workspaceId} order by created_at desc limit 1000` }));

export const POST = authed(async (req, a) => {
  const b = await body<{ channel: string; address: string; reason?: string }>(req);
  const address = b.channel === "whatsapp" ? normalizePhone(b.address) : b.address.trim().toLowerCase();
  if (!address) throw new HttpError(400, "Invalid address");
  await db()`insert into suppression_list (workspace_id, channel, address, reason, source) values (${a.workspaceId}, ${b.channel || "all"}, ${address}, ${b.reason || "manual"}, 'manual') on conflict do nothing`;
  return { ok: true };
});

export const DELETE = authed(async (req, a) => {
  const b = await body<{ channel: string; address: string }>(req);
  await db()`delete from suppression_list where workspace_id = ${a.workspaceId} and channel = ${b.channel} and address = ${b.address}`;
  return { ok: true };
});

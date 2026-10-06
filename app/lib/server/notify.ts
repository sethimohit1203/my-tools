// In-app notifications (+ optional email to the workspace owner).
import { db } from "./db";

export type NotifyInput = { type: string; title: string; body?: string; link?: string; severity?: "info" | "success" | "warning" | "error"; dedupeKey?: string; email?: boolean };

export async function notify(ws: string, n: NotifyInput) {
  const sql = db();
  const [row] = await sql`
    insert into notifications (workspace_id, type, severity, title, body, link, dedupe_key)
    values (${ws}, ${n.type}, ${n.severity || "info"}, ${n.title}, ${n.body ?? null}, ${n.link ?? null}, ${n.dedupeKey ?? null})
    on conflict (workspace_id, dedupe_key) where dedupe_key is not null do nothing
    returning id`;
  if (!row || !n.email) return;
  try {
    const [owner] = await sql`select email from workspace_members where workspace_id = ${ws} and role = 'owner' and email is not null limit 1`;
    if (!owner?.email) return;
    const { sendEmail } = await import("./email");
    await sendEmail(ws, { to: String(owner.email), subject: `[My Tools] ${n.title}`, text: `${n.body || ""}\n\n${n.link ? (process.env.APP_URL || "") + n.link : ""}` });
    await sql`update notifications set emailed_at = now() where id = ${row.id}`;
  } catch { /* email optional — in-app notification already stored */ }
}

import { authed } from "@/app/lib/server/http";
import { capabilityStatus } from "@/app/lib/server/integrations";
import { db } from "@/app/lib/server/db";

export const GET = authed(async (_req, a) => {
  const [w] = await db()`select id, name, timezone from workspaces where id = ${a.workspaceId}`;
  const [u] = await db()`select count(*)::int as n from notifications where workspace_id = ${a.workspaceId} and read_at is null`;
  return {
    user: { id: a.userId, email: a.email, role: a.role }, workspace: w, unread: Number(u.n),
    capabilities: await capabilityStatus(a.workspaceId),
    server: {
      encryption: !!process.env.ENCRYPTION_KEY, engine_secret: !!process.env.ENGINE_SECRET, app_url: !!process.env.APP_URL,
      google_oauth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), storage: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  };
});

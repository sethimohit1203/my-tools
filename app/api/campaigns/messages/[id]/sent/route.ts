import { authed } from "@/app/lib/server/http";
import { markManualSent } from "@/app/lib/server/campaigns";

export const POST = authed(async (_req, a, p) => { await markManualSent(a.workspaceId, p.id); return { ok: true }; });

import { authed } from "@/app/lib/server/http";
import "@/app/lib/server/engine";
import { checkNow } from "@/app/lib/server/monitors";

export const maxDuration = 60;
export const POST = authed(async (_req, a, p) => checkNow(a.workspaceId, p.id, a.userId));

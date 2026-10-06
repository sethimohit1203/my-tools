import { authed } from "@/app/lib/server/http";
import { listWorksheets } from "@/app/lib/server/google";

export const GET = authed(async (_req, a, p) => listWorksheets(a.workspaceId, p.id));

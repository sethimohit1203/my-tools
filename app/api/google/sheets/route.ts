import { authed } from "@/app/lib/server/http";
import { listSpreadsheets } from "@/app/lib/server/google";

export const GET = authed(async (req, a) => ({ files: await listSpreadsheets(a.workspaceId, req.nextUrl.searchParams.get("q") || "") }));

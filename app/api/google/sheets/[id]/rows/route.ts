import { authed, HttpError } from "@/app/lib/server/http";
import { readRows } from "@/app/lib/server/google";

export const GET = authed(async (req, a, p) => {
  const sheet = req.nextUrl.searchParams.get("sheet");
  if (!sheet) throw new HttpError(400, "Choose a worksheet");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 20), 200);
  const offset = Number(req.nextUrl.searchParams.get("offset") || 0);
  return readRows(a.workspaceId, p.id, sheet, { limit, offset });
});

import { authed, HttpError } from "@/app/lib/server/http";
import "@/app/lib/server/engine";
import { previewReport, queueReport } from "@/app/lib/server/reports";

export const maxDuration = 60;

export const POST = authed(async (req, a, p) => {
  if (p.action === "preview") return previewReport(a.workspaceId, p.id);
  if (p.action === "generate" || p.action === "regenerate") {
    const b = (await req.json().catch(() => ({}))) as { email_to?: string };
    return queueReport(a.workspaceId, p.id, { emailTo: b.email_to, force: p.action === "regenerate", userId: a.userId });
  }
  throw new HttpError(404, "Unknown action");
});

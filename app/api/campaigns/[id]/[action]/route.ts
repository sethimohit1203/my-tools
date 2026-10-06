import { authed, body, HttpError } from "@/app/lib/server/http";
import "@/app/lib/server/engine";
import { cancelCampaign, eligibility, pauseCampaign, renderManual, startCampaign, testCampaign } from "@/app/lib/server/campaigns";

export const maxDuration = 60;

export const POST = authed(async (req, a, p) => {
  const ws = a.workspaceId;
  switch (p.action) {
    case "preview": { const e = await eligibility(ws, p.id); const { _eligible, ...rest } = e; void _eligible; return rest; }
    case "start": case "resume": { const b = await body<{ confirm?: boolean }>(req); return startCampaign(ws, p.id, !!b.confirm); }
    case "pause": await pauseCampaign(ws, p.id); return { ok: true };
    case "cancel": await cancelCampaign(ws, p.id); return { ok: true };
    case "test": { const b = await body<{ to: string; confirm_live?: boolean }>(req); if (!b.to) throw new HttpError(400, "Enter a test recipient"); return testCampaign(ws, p.id, b.to, !!b.confirm_live, a.userId); }
    case "manual": return { messages: await renderManual(ws, p.id) };
  }
  throw new HttpError(404, "Unknown action");
});

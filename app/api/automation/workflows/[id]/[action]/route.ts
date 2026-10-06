import { authed, body, HttpError } from "@/app/lib/server/http";
import "@/app/lib/server/engine";
import { activateWorkflow, duplicateWorkflow, getWorkflow, pauseWorkflow, resumeWorkflow, startWorkflowRun, testWorkflow } from "@/app/lib/server/engine/workflows";
import { scanSheetTrigger } from "@/app/lib/server/engine/triggers";
import type { Definition } from "@/app/lib/automation/types";

export const maxDuration = 60;

export const POST = authed(async (req, a, p) => {
  const ws = a.workspaceId, id = p.id;
  switch (p.action) {
    case "activate": return activateWorkflow(ws, id, a.userId);
    case "pause": return pauseWorkflow(ws, id);
    case "resume": return resumeWorkflow(ws, id);
    case "duplicate": return { workflow: await duplicateWorkflow(ws, id, a.userId) };
    case "test": {
      const b = await body<{ input?: unknown; definition?: Partial<Definition>; confirm_live?: boolean }>(req);
      return testWorkflow(ws, id, { input: b.input, definition: b.definition, confirmLive: !!b.confirm_live, userId: a.userId });
    }
    case "run": {
      const b = await body<{ input?: unknown }>(req);
      return startWorkflowRun(ws, id, { trigger: "manual", records: b.input, userId: a.userId });
    }
    case "scan": {
      const wf = await getWorkflow(ws, id);
      if (!wf.trigger_type.startsWith("sheets_")) throw new HttpError(400, "Not a Google Sheets trigger");
      if (wf.status !== "active") throw new HttpError(409, "Activate the workflow first");
      return scanSheetTrigger(wf, { force: true });
    }
  }
  throw new HttpError(404, "Unknown action");
});

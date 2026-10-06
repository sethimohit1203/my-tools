// Daily cron (see vercel.json): runs deployed "schedule" workflows.
import { NextRequest, NextResponse } from "next/server";
import { kvEnabled, kvGet, kvLPush, kvSMembers } from "@/app/lib/server/kv";
import { runWorkflow } from "@/app/lib/server/workflow";
import type { Secrets, Workflow } from "@/app/lib/workflow-types";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!kvEnabled) return NextResponse.json({ ok: true, skipped: "storage not configured" });
  const ids = await kvSMembers("wf-scheduled");
  const results = [];
  for (const id of ids) {
    const rec = await kvGet<{ workflow: Workflow; secrets: Secrets }>(`wf:${id}`);
    if (!rec?.workflow.enabled) continue;
    let input: unknown = {};
    try { input = JSON.parse(rec.workflow.sampleInput || "{}"); } catch { /* empty */ }
    const r = await runWorkflow(rec.workflow, input, rec.secrets);
    await kvLPush(`wf-runs:${id}`, { at: new Date().toISOString(), ok: r.ok, source: "schedule", log: r.log });
    results.push({ id, ok: r.ok });
  }
  return NextResponse.json({ ok: true, ran: results });
}

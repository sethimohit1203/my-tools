// Public webhook trigger: POST JSON (or GET with query params) to
// /api/hooks/<workflow-id>?key=<token> to run a deployed workflow.
import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvLPush } from "@/app/lib/server/kv";
import { runWorkflow } from "@/app/lib/server/workflow";
import type { Secrets, Workflow } from "@/app/lib/workflow-types";

export const maxDuration = 60;

async function handle(req: NextRequest, id: string, input: unknown) {
  try {
    const rec = await kvGet<{ workflow: Workflow; secrets: Secrets; token: string }>(`wf:${id}`);
    if (!rec) return NextResponse.json({ error: "Workflow not found or not deployed" }, { status: 404 });
    if (req.nextUrl.searchParams.get("key") !== rec.token) return NextResponse.json({ error: "Invalid key" }, { status: 401 });
    if (!rec.workflow.enabled) return NextResponse.json({ error: "Workflow is paused" }, { status: 409 });
    const result = await runWorkflow(rec.workflow, input, rec.secrets);
    await kvLPush(`wf-runs:${id}`, { at: new Date().toISOString(), ok: result.ok, source: "webhook", log: result.log });
    return NextResponse.json({ ok: result.ok, steps: result.ctx.steps, log: result.log.map((l) => ({ step: l.step, ok: l.ok, error: l.error })) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/hooks/[id]">) {
  const { id } = await ctx.params;
  const text = await req.text();
  let input: unknown = {};
  try { input = text ? JSON.parse(text) : {}; } catch { input = Object.fromEntries(new URLSearchParams(text)); }
  return handle(req, id, input);
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/hooks/[id]">) {
  const { id } = await ctx.params;
  const input = Object.fromEntries([...req.nextUrl.searchParams].filter(([k]) => k !== "key"));
  return handle(req, id, input);
}

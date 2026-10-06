// Deployed workflows (needed for webhook + schedule triggers). Stored in
// Upstash Redis / Vercel KV together with the secrets they need to run.
import { NextRequest, NextResponse } from "next/server";
import { kvDel, kvEnabled, kvGet, kvLRange, kvSAdd, kvSet, kvSRem } from "@/app/lib/server/kv";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("runs");
  if (!kvEnabled) return NextResponse.json({ enabled: false });
  if (id) return NextResponse.json({ enabled: true, runs: await kvLRange(`wf-runs:${id}`, 20) });
  return NextResponse.json({ enabled: true });
}

export async function PUT(req: NextRequest) {
  const { workflow, secrets, token } = await req.json().catch(() => ({}));
  if (!workflow?.id || !token) return NextResponse.json({ error: "Missing workflow or token" }, { status: 400 });
  try {
    const existing = await kvGet<{ token: string }>(`wf:${workflow.id}`);
    if (existing && existing.token !== token) return NextResponse.json({ error: "This workflow id belongs to another browser" }, { status: 403 });
    await kvSet(`wf:${workflow.id}`, { workflow, secrets, token });
    if (workflow.trigger === "schedule" && workflow.enabled) await kvSAdd("wf-scheduled", workflow.id); else await kvSRem("wf-scheduled", workflow.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { id, token } = await req.json().catch(() => ({}));
  try {
    const existing = await kvGet<{ token: string }>(`wf:${id}`);
    if (existing && existing.token !== token) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await kvDel(`wf:${id}`);
    await kvSRem("wf-scheduled", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

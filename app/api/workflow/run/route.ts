// Run a workflow definition right now (used by the builder's "Run" button
// and by the bulk tools).
import { NextRequest, NextResponse } from "next/server";
import { runWorkflow } from "@/app/lib/server/workflow";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { workflow, input, secrets } = await req.json().catch(() => ({}));
  if (!workflow?.steps) return NextResponse.json({ error: "Missing workflow" }, { status: 400 });
  return NextResponse.json(await runWorkflow(workflow, input ?? {}, secrets || {}));
}

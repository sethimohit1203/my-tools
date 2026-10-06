// Public webhook gateway: /api/hooks/<endpoint-id>
import { NextRequest, NextResponse } from "next/server";
import { handleIncoming } from "@/app/lib/server/webhooks";
import "@/app/lib/server/engine";

export const maxDuration = 30;

async function handle(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const r = await handleIncoming(req, id);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("[hooks]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
export const POST = handle;
export const GET = handle;

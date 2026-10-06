import { NextResponse } from "next/server";
import { authed, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import "@/app/lib/server/engine";
import { cancelRun, retryRun } from "@/app/lib/server/engine/runs";
import { toCSV } from "@/app/lib/csv";

export const POST = authed(async (_req, a, p) => {
  if (p.action === "cancel") { await cancelRun(a.workspaceId, p.id); return { ok: true }; }
  if (p.action === "retry_failed") return retryRun(a.workspaceId, p.id, "failed", a.userId);
  if (p.action === "retry") return retryRun(a.workspaceId, p.id, "all", a.userId);
  throw new HttpError(404, "Unknown action");
});

// GET /api/automation/runs/:id/export (logs JSON) or /results (CSV of records + outputs)
export const GET = authed(async (_req, a, p) => {
  const sql = db();
  const [run] = await sql`select * from automation_runs where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  if (!run) throw new HttpError(404, "Run not found");
  if (p.action === "export") {
    const logs = await sql`select * from execution_logs where run_id = ${p.id} order by id`;
    const items = await sql`select * from automation_run_items where run_id = ${p.id} order by seq`;
    const steps = await sql`select * from automation_step_runs where run_id = ${p.id} order by started_at`;
    return new NextResponse(JSON.stringify({ run, logs, items, steps }, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="run-${p.id}.json"` } });
  }
  if (p.action === "results") {
    const items = await sql`select seq, status, input, context, error from automation_run_items where run_id = ${p.id} order by seq`;
    const rows = items.map((i) => {
      const rec = ((i.context as { record?: Record<string, unknown> })?.record) || (i.input as Record<string, unknown>);
      const flat = Object.fromEntries(Object.entries(rec || {}).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, typeof v === "object" && v !== null ? JSON.stringify(v) : v]));
      return { ...flat, _status: i.status, _error: (i.error as { message?: string })?.message || "" };
    });
    return new NextResponse("﻿" + toCSV(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="results-${p.id}.csv"` } });
  }
  throw new HttpError(404, "Unknown export");
});

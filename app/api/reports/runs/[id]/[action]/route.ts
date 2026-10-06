import { NextResponse } from "next/server";
import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { emailReportRun, pdfFor, signedPdfUrl } from "@/app/lib/server/reports";

export const maxDuration = 60;

export const GET = authed(async (_req, a, p) => {
  if (p.action !== "pdf") throw new HttpError(404, "Unknown");
  const [rr] = await db()`select pdf_path from report_runs where id = ${p.id} and workspace_id = ${a.workspaceId}`;
  if (!rr) throw new HttpError(404, "Report run not found");
  if (rr.pdf_path) { const url = await signedPdfUrl(String(rr.pdf_path)); if (url) return { url }; }
  const pdf = await pdfFor(a.workspaceId, p.id);
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="report-${p.id}.pdf"` } });
});

export const POST = authed(async (req, a, p) => {
  if (p.action !== "email") throw new HttpError(404, "Unknown");
  const b = await body<{ to: string }>(req);
  if (!b.to) throw new HttpError(400, "Enter an email address");
  return emailReportRun(a.workspaceId, p.id, b.to);
});

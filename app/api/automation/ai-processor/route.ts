// AI Auto-Processor: rows from CSV / Google Sheets / CRM → one run, AI fills
// validated output fields per row (n8n executes in the background).
import { authed, body, HttpError } from "@/app/lib/server/http";
import { db } from "@/app/lib/server/db";
import { readRows } from "@/app/lib/server/google";
import { createRun, dispatchRun, executeInline } from "@/app/lib/server/engine/runs";
import { capabilityStatus, getIntegration } from "@/app/lib/server/integrations";
import { parseOutputs, type Definition } from "@/app/lib/automation/types";

export const maxDuration = 60;

export const POST = authed(async (req, a) => {
  const b = await body<{ source: "csv" | "sheet" | "crm"; rows?: Record<string, unknown>[]; spreadsheet_id?: string; sheet?: string; lead_filter?: { min_score?: number; stage?: string }; input_columns?: string[]; instruction: string; outputs: string; write_back?: boolean; test?: boolean; name?: string }>(req);
  const ws = a.workspaceId;
  const caps = await capabilityStatus(ws);
  if (!caps.ai) throw new HttpError(400, "Integration Required: AI provider", "integration_required");
  if (!b.instruction?.trim()) throw new HttpError(400, "Write the AI instruction");
  const fields = parseOutputs(b.outputs);
  if (!fields.length) throw new HttpError(400, "Define at least one output field");
  let rows: Record<string, unknown>[] = [];
  if (b.source === "csv") rows = b.rows || [];
  else if (b.source === "sheet") {
    if (!caps.google) throw new HttpError(400, "Integration Required: Google", "integration_required");
    rows = (await readRows(ws, String(b.spreadsheet_id), String(b.sheet))).rows;
  } else if (b.source === "crm") {
    const sql = db();
    rows = await sql`select id as lead_id, name, category, phone, email, website, city, rating, reviews, lead_score, stage, recommended_service from leads where workspace_id = ${ws}
      ${b.lead_filter?.min_score ? sql`and coalesce(lead_score,0) >= ${b.lead_filter.min_score}` : sql``} ${b.lead_filter?.stage ? sql`and stage = ${b.lead_filter.stage}` : sql``} order by created_at desc limit 5000`;
  }
  if (!rows.length) throw new HttpError(400, "No rows to process");
  if (rows.length > 10000) throw new HttpError(400, "Max 10,000 rows per run");
  const cols = b.input_columns?.length ? b.input_columns : null;
  const records = rows.map((r) => (cols ? { ...Object.fromEntries(cols.map((c) => [c, r[c]])), _row: r._row, lead_id: r.lead_id } : r));
  const steps: Definition["steps"] = [{ key: "ai", type: "ai_analyze", name: "AI Analyze", config: { instruction: b.instruction, outputs: b.outputs } }];
  if (b.write_back && b.source === "sheet") steps.push({ key: "write", type: "sheets_write", name: "Write back", config: { spreadsheet_id: b.spreadsheet_id, sheet: b.sheet, mode: "update", key_column: "_row", row: fields.map((f) => ({ key: f.name, value: `{{${f.name}}}` })) } });
  if (b.write_back && b.source === "crm") steps.push({ key: "write", type: "update_lead", name: "Update lead", config: { match: "id", value: "{{lead_id}}", fields: fields.map((f) => ({ key: ["lead_score", "recommended_service", "pitch", "temperature", "category", "city", "notes"].includes(f.name) ? f.name : `data_${f.name}`, value: `{{${f.name}}}` })).filter((x) => !x.key.startsWith("data_")) } });
  const definition: Definition = { trigger: { type: "manual", config: {} }, steps };
  const aiRate = Number((await getIntegration(ws, "ai"))?.config.rate_per_minute) || 30;
  const run = await createRun({ ws, kind: "ai_processor", trigger: b.test ? "test" : "manual", workflowName: b.name || `AI Processor (${b.source})`, records: b.test ? records.slice(0, 1) : records, isTest: !!b.test, createdBy: a.userId, maxAttempts: b.test ? 1 : 3, input: { definition, source: b.source, outputs: fields, spreadsheet_id: b.spreadsheet_id, sheet: b.sheet, ratePerMinute: aiRate, confirm_live: false } });
  if (b.test) return { run_id: run.id, ...(await executeInline(run.id)) };
  if (!caps.n8n) return { run_id: run.id, dispatched: false, error: "Integration Required: n8n — the run is queued and starts when n8n is connected" };
  const d = await dispatchRun(ws, run.id);
  return { run_id: run.id, dispatched: d.dispatched, error: d.error, total: records.length };
});

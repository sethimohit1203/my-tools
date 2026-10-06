// Bulk import (Lead Finder "Save to CRM", CSV import, browser-CRM migration).
import { authed, body, HttpError } from "@/app/lib/server/http";
import { upsertLead } from "@/app/lib/server/leads-db";
import { emitEvent } from "@/app/lib/server/engine/triggers";

export const maxDuration = 60;

export const POST = authed(async (req, a) => {
  const { leads } = await body<{ leads: Record<string, unknown>[] }>(req);
  if (!Array.isArray(leads) || !leads.length) throw new HttpError(400, "No leads");
  if (leads.length > 2000) throw new HttpError(400, "Max 2000 leads per import");
  let created = 0, updated = 0;
  const failed: { name: unknown; error: string }[] = [];
  for (const l of leads) {
    try {
      const r = await upsertLead(a.workspaceId, l);
      if (r.created) { created++; await emitEvent(a.workspaceId, "new_lead", { ...l, lead_id: r.id }); } else updated++;
    } catch (e) { failed.push({ name: l.name, error: (e as Error).message }); }
  }
  return { created, updated, failed };
});

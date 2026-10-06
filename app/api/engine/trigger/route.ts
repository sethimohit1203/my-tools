// Called by a per-workflow n8n cron workflow.
import { body, engine, HttpError } from "@/app/lib/server/http";
import { fireSchedule } from "@/app/lib/server/engine";

export const maxDuration = 30;
export const POST = engine(async (req) => {
  const b = await body<{ schedule_id?: string; fired_at?: string }>(req);
  if (!b.schedule_id) throw new HttpError(400, "schedule_id required");
  return fireSchedule(b.schedule_id, b.fired_at ? new Date(b.fired_at) : new Date());
});

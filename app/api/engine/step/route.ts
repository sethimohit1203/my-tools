// Called in a loop by n8n's Run Processor. Bounded work per call.
import { body, engine, HttpError } from "@/app/lib/server/http";
import { stepRun } from "@/app/lib/server/engine";

export const maxDuration = 60;

export const POST = engine(async (req) => {
  const { run_id } = await body<{ run_id?: string }>(req);
  if (!run_id || !/^[0-9a-f-]{36}$/i.test(run_id)) throw new HttpError(400, "run_id required");
  const r = await stepRun(run_id, 40000);
  return { run_id, ...r };
});

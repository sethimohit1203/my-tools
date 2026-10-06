// Called every 5 minutes by n8n's Scheduler Tick workflow.
import { engine } from "@/app/lib/server/http";
import { tick } from "@/app/lib/server/engine";

export const maxDuration = 60;
export const POST = engine(async () => tick());

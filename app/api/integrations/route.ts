import { authed } from "@/app/lib/server/http";
import { listIntegrations } from "@/app/lib/server/integrations";

export const GET = authed(async (_req, a) => ({ integrations: await listIntegrations(a.workspaceId) }));

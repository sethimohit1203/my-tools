import { NextResponse } from "next/server";
import { authed, HttpError } from "@/app/lib/server/http";
import { PROVIDERS, type Provider } from "@/app/lib/server/integrations";
import { testIntegration } from "@/app/lib/server/integration-tests";
import { engineExport, installEngine } from "@/app/lib/server/engine/n8n";
import { listTemplates } from "@/app/lib/server/whatsapp";

export const maxDuration = 60;

export const POST = authed(async (_req, a, p) => {
  if (!(p.provider in PROVIDERS)) throw new HttpError(404, "Unknown integration");
  const prov = p.provider as Provider;
  if (p.action === "test") return testIntegration(a.workspaceId, prov);
  if (p.action === "install" && prov === "n8n") return installEngine(a.workspaceId);
  throw new HttpError(404, "Unknown action");
});

export const GET = authed(async (_req, a, p) => {
  if (p.provider === "n8n" && p.action === "export") {
    return new NextResponse(JSON.stringify(engineExport(a.workspaceId), null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="mytools-n8n-engine.json"' } });
  }
  if (p.provider === "whatsapp" && p.action === "templates") return { templates: await listTemplates(a.workspaceId) };
  throw new HttpError(404, "Unknown action");
});

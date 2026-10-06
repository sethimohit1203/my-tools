import { authed, body, HttpError } from "@/app/lib/server/http";
import { disconnectIntegration, getIntegration, PROVIDERS, saveIntegration, type Provider } from "@/app/lib/server/integrations";
import { testIntegration } from "@/app/lib/server/integration-tests";
import { randomToken } from "@/app/lib/server/crypto";

function provider(p: string): Provider {
  if (!(p in PROVIDERS)) throw new HttpError(404, "Unknown integration");
  return p as Provider;
}

// Save config (secrets are write-only), then test the connection right away.
export const POST = authed(async (req, a, p) => {
  const prov = provider(p.provider);
  if (PROVIDERS[prov].oauth) throw new HttpError(400, "Use “Connect with Google” for this integration");
  const input = await body<Record<string, string>>(req);
  const extra: Record<string, string> = {};
  if (prov === "whatsapp" && !(await getIntegration(a.workspaceId, prov))?.config.verify_token) extra._verify_token = randomToken(16);
  await saveIntegration(a.workspaceId, prov, { ...input, ...extra });
  return testIntegration(a.workspaceId, prov);
});

export const DELETE = authed(async (_req, a, p) => {
  await disconnectIntegration(a.workspaceId, provider(p.provider));
  return { ok: true };
});

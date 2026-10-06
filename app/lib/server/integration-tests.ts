// "Test connection" for each integration — real calls to each provider.
import { getIntegration, setIntegrationStatus, type Provider } from "./integrations";
import { HttpError } from "./db";
import { runAI, type Provider as AIProvider } from "./ai";
import { testGoogle } from "./google";
import { testResend, testSmtp } from "./email";
import { testWhatsApp } from "./whatsapp";
import { testWordPress } from "./wordpress";
import { testSocial } from "./social";
import { testN8n } from "./engine/n8n";
import { providerFetch } from "./errors";

export async function testIntegration(ws: string, provider: Provider): Promise<{ ok: boolean; message: string }> {
  const i = await getIntegration(ws, provider);
  if (!i) throw new HttpError(400, "Configure the integration first");
  const c = i.config, s = i.secrets;
  try {
    let message = "";
    switch (provider) {
      case "ai": { const t = await runAI({ provider: (c.provider as AIProvider) || "groq", model: c.model || undefined, apiKey: s.api_key, prompt: "Reply with exactly: OK", maxTokens: 20 }); message = `AI replied: ${t.slice(0, 40)}`; break; }
      case "n8n": message = await testN8n(c, s); break;
      case "google": message = await testGoogle(ws); break;
      case "google_places": { const { data } = await providerFetch("google_places", "https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": s.api_key, "X-Goog-FieldMask": "places.id" }, body: JSON.stringify({ textQuery: "cafe in Delhi", pageSize: 1 }) }); message = `Places API OK (${((data as { places?: unknown[] }).places || []).length} result)`; break; }
      case "smtp": message = await testSmtp(c, s); break;
      case "resend": message = await testResend(s); break;
      case "whatsapp": message = await testWhatsApp(c, s); break;
      case "wordpress": message = await testWordPress(c, s); break;
      case "facebook": case "instagram": case "linkedin": case "social_webhook": message = await testSocial(provider, c, s); break;
    }
    await setIntegrationStatus(ws, provider, "connected", null);
    return { ok: true, message };
  } catch (e) {
    const msg = (e as Error).message;
    await setIntegrationStatus(ws, provider, "error", msg);
    return { ok: false, message: msg };
  }
}

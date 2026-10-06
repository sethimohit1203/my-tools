"use client";
import { useState } from "react";
import { Banner, Card, Field, Shell } from "../lib/ui";
import { api, useSettings, type Provider, type Settings } from "../lib/settings";

const PROVIDERS: { id: Provider; label: string; key: keyof Settings; help: string }[] = [
  { id: "groq", label: "Groq (free, fast)", key: "groqKey", help: "console.groq.com → API Keys" },
  { id: "gemini", label: "Gemini (free tier)", key: "gemKey", help: "aistudio.google.com → Get API key" },
  { id: "claude", label: "Claude", key: "claudeKey", help: "console.anthropic.com → API Keys" },
  { id: "gpt", label: "OpenAI GPT-4o", key: "oaiKey", help: "platform.openai.com → API keys" },
];

export default function SettingsPage() {
  const [s, set] = useSettings();
  const [test, setTest] = useState("");

  const input = (k: keyof Settings, placeholder = "", type = "text") => (
    <input className="tk-input" type={type} value={String(s[k] ?? "")} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<Settings>)} />
  );

  async function testAI() {
    setTest("Testing…");
    try {
      const key = PROVIDERS.find((p) => p.id === s.aiProvider)!.key;
      const r = await api<{ text: string }>("/api/ai", { provider: s.aiProvider, apiKey: s[key], prompt: "Reply with exactly: OK, connected." });
      setTest("✅ " + r.text);
    } catch (e) { setTest("❌ " + (e as Error).message); }
  }

  return (
    <Shell icon="⚙" title="Settings" desc="One place for every API key. Keys are saved in this browser only (localStorage) and sent to this app's own server just to make the call. On Vercel you can instead set env vars (ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, GOOGLE_PLACES_API_KEY, RESEND_API_KEY, EMAIL_FROM, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WP_URL, WP_USER, WP_APP_PASSWORD, SHEETS_WEBHOOK_URL).">
      <Card title="🤖 AI provider (used by every AI feature)">
        <div className="tk-row" style={{ marginBottom: 12 }}>
          {PROVIDERS.map((p) => (
            <button key={p.id} className={`tk-tab${s.aiProvider === p.id ? " on" : ""}`} onClick={() => set({ aiProvider: p.id })}>{p.label}</button>
          ))}
        </div>
        <div className="tk-grid" style={{ ["--min" as string]: "260px" }}>
          {PROVIDERS.map((p) => (
            <Field key={p.id} label={`${p.label} key`} hint={p.help}>{input(p.key, "", "password")}</Field>
          ))}
        </div>
        <div className="tk-row" style={{ marginTop: 12 }}>
          <button className="tk-btn primary" onClick={testAI}>Test AI connection</button>
          <span className="tk-muted">{test}</span>
        </div>
      </Card>

      <Card title="📍 Google Places (optional — Maps extractor)">
        <Field label="Google Places API key" hint="console.cloud.google.com → enable “Places API (New)” → Credentials. Without it, the free OpenStreetMap source is used.">{input("googlePlacesKey", "AIza…", "password")}</Field>
      </Card>

      <Card title="📧 Email (Resend)">
        <div className="tk-grid">
          <Field label="Resend API key" hint="resend.com → API Keys (free 3,000 emails/month). Verify your domain there.">{input("resendKey", "re_…", "password")}</Field>
          <Field label="From address" hint='e.g. "Designoia <hello@designoia.com>"'>{input("emailFrom", "Designoia <hello@yourdomain.com>")}</Field>
        </div>
      </Card>

      <Card title="💬 WhatsApp Business Cloud API (official)">
        <Banner tone="warn">Use Meta&apos;s official API — never browser automation. Free-form messages only work within 24h of the customer messaging you; first contact needs an approved message template. Without these keys the tools fall back to one-click wa.me links you send yourself.</Banner>
        <div className="tk-grid">
          <Field label="Access token" hint="developers.facebook.com → your app → WhatsApp → API Setup (use a permanent System User token).">{input("waToken", "EAAG…", "password")}</Field>
          <Field label="Phone number ID">{input("waPhoneId", "1234567890")}</Field>
        </div>
      </Card>

      <Card title="📋 Google Sheets & webhooks">
        <div className="tk-grid">
          <Field label="Apps Script web app URL (write to Sheets)" hint="Set it up in 2 minutes from the Sheets Automation tool.">{input("sheetsWebhook", "https://script.google.com/macros/s/…/exec")}</Field>
          <Field label="Social publishing webhook (n8n / Make / Buffer)" hint="Used by Social Media Automation to publish posts.">{input("socialWebhook", "https://…")}</Field>
        </div>
      </Card>

      <Card title="🌐 WordPress site">
        <div className="tk-grid">
          <Field label="Site URL">{input("wpUrl", "https://yoursite.com")}</Field>
          <Field label="Username">{input("wpUser", "admin")}</Field>
          <Field label="Application password" hint="WP Admin → Users → Profile → Application Passwords.">{input("wpPass", "xxxx xxxx xxxx xxxx", "password")}</Field>
        </div>
      </Card>

      <Card title="🏢 Your agency (used in proposals & messages)">
        <div className="tk-grid">
          <Field label="Agency name">{input("agencyName", "Designoia")}</Field>
          <Field label="Phone">{input("agencyPhone", "+91 …")}</Field>
          <Field label="Email">{input("agencyEmail", "hello@…")}</Field>
          <Field label="Website">{input("agencyWebsite", "https://…")}</Field>
        </div>
      </Card>
    </Shell>
  );
}

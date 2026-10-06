// Workflow definitions shared by the builder UI and the server engine.

export type StepType = "ai" | "condition" | "set" | "http" | "email" | "whatsapp" | "wordpress" | "sheets" | "audit" | "monitor";

export type Step = { id: string; type: StepType; name: string; config: Record<string, string> };

export type Trigger = "manual" | "webhook" | "schedule" | "sheet_row";

export type Secrets = {
  aiProvider?: string; aiKey?: string; resendKey?: string; emailFrom?: string;
  waToken?: string; waPhoneId?: string; sheetsWebhook?: string;
  wpUrl?: string; wpUser?: string; wpPass?: string;
};

export type Workflow = {
  id: string;
  name: string;
  trigger: Trigger;
  sampleInput: string; // JSON
  steps: Step[];
  enabled: boolean;
  updatedAt: string;
};

export type RunLog = { step: string; type: StepType | "trigger"; ok: boolean; skipped?: boolean; output?: unknown; error?: string; ms: number };

export const STEP_CATALOG: Record<StepType, { icon: string; label: string; desc: string; fields: { key: string; label: string; type?: "text" | "textarea" | "select"; options?: string[]; placeholder?: string }[] }> = {
  ai: { icon: "🤖", label: "AI", desc: "Ask AI to write, classify or extract. Output saved as {{steps.<name>}}.", fields: [
    { key: "prompt", label: "Prompt", type: "textarea", placeholder: "Write a short WhatsApp intro for {{input.name}} ({{input.category}}) …" },
    { key: "json", label: "Output", type: "select", options: ["text", "json"] },
  ] },
  condition: { icon: "🔀", label: "Condition", desc: "Stop (or skip the next step) unless the condition is true.", fields: [
    { key: "left", label: "Value", placeholder: "{{steps.score.leadScore}}" },
    { key: "op", label: "Operator", type: "select", options: ["equals", "not_equals", "contains", "gt", "lt", "exists", "not_exists"] },
    { key: "right", label: "Compare to", placeholder: "70" },
    { key: "onFalse", label: "If false", type: "select", options: ["stop", "skip_next"] },
  ] },
  set: { icon: "📝", label: "Set variable", desc: "Store a value as {{vars.<key>}}.", fields: [
    { key: "key", label: "Variable name", placeholder: "greeting" },
    { key: "value", label: "Value", type: "textarea", placeholder: "Hi {{input.name}}" },
  ] },
  http: { icon: "🌐", label: "HTTP / Webhook", desc: "Call any API or webhook (n8n, Make, Zapier, Buffer…).", fields: [
    { key: "method", label: "Method", type: "select", options: ["POST", "GET", "PUT", "PATCH", "DELETE"] },
    { key: "url", label: "URL", placeholder: "https://…" },
    { key: "body", label: "JSON body", type: "textarea", placeholder: '{"name":"{{input.name}}"}' },
    { key: "headers", label: "Headers (JSON)", placeholder: '{"Authorization":"Bearer …"}' },
  ] },
  email: { icon: "📧", label: "Send email", desc: "Send via Resend (key in Settings).", fields: [
    { key: "to", label: "To", placeholder: "{{input.email}}" },
    { key: "subject", label: "Subject", placeholder: "Quick idea for {{input.name}}" },
    { key: "body", label: "Body", type: "textarea", placeholder: "{{steps.write}}" },
  ] },
  whatsapp: { icon: "💬", label: "Send WhatsApp", desc: "WhatsApp Business Cloud API. Outside a 24h chat window Meta requires an approved template.", fields: [
    { key: "to", label: "Phone", placeholder: "{{input.phone}}" },
    { key: "text", label: "Message (session message)", type: "textarea", placeholder: "{{steps.write}}" },
    { key: "template", label: "Template name (optional)", placeholder: "lead_intro" },
    { key: "params", label: "Template params (comma separated)", placeholder: "{{input.name}}, Designoia" },
  ] },
  wordpress: { icon: "🌐", label: "WordPress", desc: "Create/update a post on the site in Settings.", fields: [
    { key: "action", label: "Action", type: "select", options: ["create_post", "update_post", "create_page"] },
    { key: "postId", label: "Post ID (update only)", placeholder: "{{input.id}}" },
    { key: "title", label: "Title", placeholder: "{{steps.blog.title}}" },
    { key: "content", label: "Content (HTML)", type: "textarea", placeholder: "{{steps.blog.html}}" },
    { key: "status", label: "Status", type: "select", options: ["draft", "publish", "future"] },
    { key: "date", label: "Schedule date (ISO, for future)", placeholder: "2026-10-20T09:00:00" },
    { key: "meta", label: "Meta JSON (Rank Math etc.)", placeholder: '{"rank_math_description":"…"}' },
  ] },
  sheets: { icon: "📋", label: "Google Sheets", desc: "Append or update a row via your Apps Script web app.", fields: [
    { key: "action", label: "Action", type: "select", options: ["append", "update"] },
    { key: "sheet", label: "Tab name", placeholder: "Leads" },
    { key: "row", label: "Row (JSON object)", type: "textarea", placeholder: '{"Name":"{{input.name}}","Score":"{{steps.score}}"}' },
    { key: "matchColumn", label: "Match column (update)", placeholder: "Name" },
  ] },
  audit: { icon: "🩺", label: "Website audit", desc: "Audit a URL (score, SEO, WhatsApp, forms…).", fields: [
    { key: "url", label: "URL", placeholder: "{{input.website}}" },
  ] },
  monitor: { icon: "🔔", label: "Uptime check", desc: "Check a URL is up; output {up, status, ms, title}.", fields: [
    { key: "url", label: "URL", placeholder: "https://example.com" },
  ] },
};

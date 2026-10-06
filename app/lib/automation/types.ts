// Workflow definition model shared by the builder UI and the server engine.
// A workflow is stored as JSON in automation_workflows.definition.

export type TriggerType =
  | "manual" | "webhook" | "schedule" | "sheets_new_row" | "sheets_updated_row"
  | "new_lead" | "wordpress_event" | "monitor_event" | "campaign_event";

export type ActionType =
  | "ai_generate" | "ai_analyze" | "sheets_read" | "sheets_write" | "send_email" | "send_whatsapp"
  | "wordpress" | "http_request" | "webhook" | "create_lead" | "update_lead" | "generate_report"
  | "notification" | "delay" | "loop" | "transform" | "maps_search" | "website_audit" | "lead_score"
  | "social_publish" | "generate_pdf" | "condition";

export type ConditionOp = "equals" | "not_equals" | "contains" | "not_contains" | "gt" | "lt" | "gte" | "lte" | "exists" | "empty";
export type Rule = { left: string; op: ConditionOp; right?: string };

export type Node = { key: string; type: ActionType; name: string; config: Record<string, unknown> };

export type Definition = {
  trigger: { type: TriggerType; config: Record<string, unknown> };
  steps: Node[];
  settings?: { maxAttempts?: number; ratePerMinute?: number; sampleInput?: string };
};

export const RUN_STATUSES = ["queued", "running", "paused", "completed", "partially_completed", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

type Field = { key: string; label: string; type?: "text" | "textarea" | "select" | "number" | "json" | "rules" | "fields"; options?: string[]; placeholder?: string; required?: boolean; help?: string };

export const TRIGGERS: Record<TriggerType, { icon: string; label: string; desc: string; requires?: string[]; fields: Field[] }> = {
  manual: { icon: "▶️", label: "Manual", desc: "Run on demand with the records you provide (JSON).", fields: [] },
  webhook: { icon: "🪝", label: "Webhook", desc: "An HTTP request to the workflow's secure webhook URL starts a run. Create the endpoint in Webhooks after saving.", fields: [] },
  schedule: { icon: "⏰", label: "Schedule", desc: "Runs on a schedule executed by n8n.", requires: ["n8n"], fields: [
    { key: "kind", label: "Repeat", type: "select", options: ["once", "hourly", "daily", "weekly", "monthly", "interval"] },
    { key: "at_time", label: "Time (HH:MM)", placeholder: "09:00" },
    { key: "day_of_week", label: "Day of week (0=Sun)", type: "number" },
    { key: "day_of_month", label: "Day of month", type: "number" },
    { key: "interval_minutes", label: "Every N minutes (interval)", type: "number" },
    { key: "run_at", label: "Run at (once, ISO)", placeholder: "2026-11-01T09:00:00+05:30" },
    { key: "timezone", label: "Timezone", placeholder: "Asia/Kolkata" },
    { key: "input", label: "Input records (JSON)", type: "json", placeholder: "[{}]" },
  ] },
  sheets_new_row: { icon: "📋", label: "Google Sheets — new row", desc: "Polls the sheet (every 5 min via n8n) and runs once per new row.", requires: ["google", "n8n"], fields: [
    { key: "spreadsheet_id", label: "Spreadsheet ID", required: true },
    { key: "sheet", label: "Worksheet", required: true },
    { key: "key_column", label: "Unique key column (optional)", help: "Used to identify rows; defaults to the row number." },
    { key: "filter", label: "Only rows matching", type: "rules" },
  ] },
  sheets_updated_row: { icon: "✏️", label: "Google Sheets — updated row", desc: "Runs when an existing row's values change.", requires: ["google", "n8n"], fields: [
    { key: "spreadsheet_id", label: "Spreadsheet ID", required: true },
    { key: "sheet", label: "Worksheet", required: true },
    { key: "key_column", label: "Unique key column", required: true },
    { key: "filter", label: "Only rows matching", type: "rules" },
  ] },
  new_lead: { icon: "🧲", label: "New lead", desc: "Runs when a lead is created in the CRM (Lead Finder, import, API, workflow).", fields: [
    { key: "filter", label: "Only leads matching", type: "rules" },
  ] },
  wordpress_event: { icon: "🌐", label: "WordPress event", desc: "Runs when your WordPress site calls the workflow webhook (e.g. WP Webhooks plugin on post publish).", fields: [
    { key: "event", label: "Event name filter (optional)", placeholder: "post_published" },
  ] },
  monitor_event: { icon: "🔔", label: "Website monitor event", desc: "Runs when a monitor detects downtime or a significant change.", fields: [
    { key: "event", label: "Event", type: "select", options: ["any", "down", "up", "change", "ssl_expiring", "new_page", "page_removed"] },
  ] },
  campaign_event: { icon: "📬", label: "Campaign event", desc: "Runs when a campaign lead replies, opts out or bounces.", fields: [
    { key: "event", label: "Event", type: "select", options: ["any", "replied", "opted_out", "bounced", "completed"] },
  ] },
};

export const ACTIONS: Record<ActionType, { icon: string; label: string; group: string; desc: string; requires?: string[]; sideEffect?: boolean; fields: Field[] }> = {
  condition: { icon: "🔀", label: "Condition", group: "Logic", desc: "Continue only when the rules match (AND / OR).", fields: [
    { key: "rules", label: "Rules", type: "rules" },
    { key: "combinator", label: "Combine", type: "select", options: ["and", "or"] },
    { key: "onFalse", label: "If false", type: "select", options: ["stop", "skip_next"] },
  ] },
  delay: { icon: "⏳", label: "Delay", group: "Logic", desc: "Wait before the next step (n8n waits; nothing runs on Vercel meanwhile).", fields: [
    { key: "amount", label: "Amount", type: "number", required: true },
    { key: "unit", label: "Unit", type: "select", options: ["minutes", "hours", "days"] },
  ] },
  loop: { icon: "🔁", label: "Loop", group: "Logic", desc: "Run the remaining steps once per element of a list (each becomes its own record).", fields: [
    { key: "items", label: "List path", placeholder: "steps.read.rows", required: true },
    { key: "max", label: "Max items", type: "number" },
  ] },
  transform: { icon: "🧮", label: "Transform data", group: "Logic", desc: "Set fields from templates, e.g. full_name = {{first}} {{last}}. Start a value with = for arithmetic: ={{present}}/{{total}}*100", fields: [
    { key: "fields", label: "Fields", type: "fields" },
  ] },
  ai_generate: { icon: "✨", label: "AI Generate", group: "AI", desc: "Generate text from a prompt.", requires: ["ai"], fields: [
    { key: "prompt", label: "Prompt", type: "textarea", required: true, placeholder: "Write a 3-line WhatsApp intro for {{name}} ({{category}}, {{city}})" },
    { key: "max_tokens", label: "Max tokens", type: "number" },
  ] },
  ai_analyze: { icon: "🧠", label: "AI Analyze (structured)", group: "AI", desc: "Return validated JSON fields; invalid output is repaired or the record fails.", requires: ["ai"], fields: [
    { key: "instruction", label: "Instruction", type: "textarea", required: true },
    { key: "outputs", label: "Output fields (name:type, …)", required: true, placeholder: "lead_score:number, priority:enum(HIGH|MEDIUM|LOW), pitch:string" },
  ] },
  sheets_read: { icon: "📖", label: "Google Sheets — read", group: "Google", desc: "Read rows (use Loop to process each).", requires: ["google"], fields: [
    { key: "spreadsheet_id", label: "Spreadsheet ID", required: true },
    { key: "sheet", label: "Worksheet", required: true },
    { key: "limit", label: "Max rows", type: "number" },
  ] },
  sheets_write: { icon: "📝", label: "Google Sheets — write", group: "Google", desc: "Append a row, or update the row whose key column matches.", requires: ["google"], sideEffect: true, fields: [
    { key: "spreadsheet_id", label: "Spreadsheet ID", required: true },
    { key: "sheet", label: "Worksheet", required: true },
    { key: "mode", label: "Mode", type: "select", options: ["append", "update", "upsert"] },
    { key: "key_column", label: "Key column (update/upsert)" },
    { key: "row", label: "Row (column → value template)", type: "fields", required: true },
  ] },
  send_email: { icon: "📧", label: "Send email", group: "Messaging", desc: "Gmail, SMTP or Resend. Checks suppression list and duplicates.", requires: ["email"], sideEffect: true, fields: [
    { key: "to", label: "To", required: true, placeholder: "{{email}}" },
    { key: "subject", label: "Subject", required: true },
    { key: "body", label: "Body", type: "textarea", required: true },
  ] },
  send_whatsapp: { icon: "💬", label: "Send WhatsApp", group: "Messaging", desc: "Official Cloud API. Outside a 24h window you must use an approved template.", requires: ["whatsapp"], sideEffect: true, fields: [
    { key: "to", label: "Phone", required: true, placeholder: "{{phone}}" },
    { key: "template", label: "Approved template name" },
    { key: "language", label: "Template language", placeholder: "en" },
    { key: "params", label: "Template params (comma separated)", placeholder: "{{name}}, Designoia" },
    { key: "text", label: "Text (only within 24h session)", type: "textarea" },
  ] },
  wordpress: { icon: "🌐", label: "WordPress", group: "Publishing", desc: "Create/update posts or pages, featured image, SEO meta, ACF, schema, schedule. Never duplicates (external ID).", requires: ["wordpress"], sideEffect: true, fields: [
    { key: "operation", label: "Operation", type: "select", options: ["create_post", "update_post", "create_page", "update_page", "upload_media"] },
    { key: "external_id", label: "External ID (dedupe)", placeholder: "{{row_key}}" },
    { key: "post_id", label: "Post/page ID (update)" },
    { key: "title", label: "Title" },
    { key: "content", label: "Content (HTML)", type: "textarea" },
    { key: "excerpt", label: "Excerpt" },
    { key: "status", label: "Status", type: "select", options: ["draft", "publish", "future", "pending"] },
    { key: "date", label: "Publish date (future)" },
    { key: "categories", label: "Categories (comma)" },
    { key: "tags", label: "Tags (comma)" },
    { key: "featured_image_url", label: "Featured image URL" },
    { key: "seo_title", label: "SEO title" },
    { key: "seo_description", label: "Meta description" },
    { key: "focus_keyword", label: "Focus keyword" },
    { key: "acf", label: "ACF fields (JSON)", type: "json" },
    { key: "schema", label: "JSON-LD schema (JSON)", type: "json" },
  ] },
  social_publish: { icon: "📱", label: "Social post", group: "Publishing", desc: "Queue a post for approval/publishing (Facebook, Instagram, LinkedIn or webhook).", requires: ["social"], sideEffect: true, fields: [
    { key: "platform", label: "Platform", type: "select", options: ["facebook", "instagram", "linkedin", "webhook"] },
    { key: "caption", label: "Caption", type: "textarea", required: true },
    { key: "hashtags", label: "Hashtags" },
    { key: "media_url", label: "Image URL" },
    { key: "scheduled_for", label: "Schedule (ISO, optional)" },
    { key: "approval", label: "Approval", type: "select", options: ["manual", "auto"] },
  ] },
  http_request: { icon: "🌍", label: "HTTP request", group: "Developer", desc: "Call any API; response saved for later steps.", fields: [
    { key: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
    { key: "url", label: "URL", required: true },
    { key: "headers", label: "Headers (JSON)", type: "json" },
    { key: "body", label: "Body (JSON template)", type: "json" },
    { key: "timeout_ms", label: "Timeout (ms)", type: "number" },
  ] },
  webhook: { icon: "📤", label: "Send webhook", group: "Developer", desc: "POST the current record (or a custom body) to a URL.", sideEffect: true, fields: [
    { key: "url", label: "URL", required: true },
    { key: "body", label: "Body (JSON template, default = record)", type: "json" },
  ] },
  create_lead: { icon: "🧲", label: "Create lead", group: "CRM", desc: "Add to the shared CRM (dedupes on source reference).", fields: [
    { key: "fields", label: "Lead fields", type: "fields", help: "name, email, phone, website, category, city, lead_score, recommended_service, pitch, source_ref…" },
  ] },
  update_lead: { icon: "🗂", label: "Update lead", group: "CRM", desc: "Update a lead by id, email or phone.", fields: [
    { key: "match", label: "Match by", type: "select", options: ["id", "email", "phone"] },
    { key: "value", label: "Match value", required: true, placeholder: "{{lead_id}}" },
    { key: "fields", label: "Fields to set", type: "fields" },
  ] },
  maps_search: { icon: "🗺️", label: "Find businesses (Maps)", group: "Business", desc: "OpenStreetMap (free) or Google Places search; outputs a list for Loop.", fields: [
    { key: "query", label: "Business type", required: true, placeholder: "cafes" },
    { key: "location", label: "Location", required: true, placeholder: "Laxmi Nagar, Delhi" },
    { key: "radius_m", label: "Radius (m)", type: "number" },
    { key: "limit", label: "Max results", type: "number" },
    { key: "source", label: "Source", type: "select", options: ["osm", "google"] },
  ] },
  website_audit: { icon: "🩺", label: "Website audit", group: "Business", desc: "Fetch and score a website (SEO, speed, mobile, WhatsApp, forms, social).", fields: [
    { key: "url", label: "URL", required: true, placeholder: "{{website}}" },
  ] },
  lead_score: { icon: "🎯", label: "Calculate lead score", group: "Business", desc: "Designoia scoring from business + audit data; recommends services/bundle.", fields: [
    { key: "audit_step", label: "Audit step name (optional)", placeholder: "audit" },
  ] },
  generate_pdf: { icon: "📄", label: "Generate PDF", group: "Reports", desc: "Create a PDF (certificate, question paper, summary) and store it; output has a download URL.", sideEffect: false, fields: [
    { key: "title", label: "Title", required: true, placeholder: "Certificate of Completion" },
    { key: "body", label: "Content", type: "textarea", required: true, placeholder: "This certifies that {{student_name}} completed {{course}}." },
    { key: "layout", label: "Layout", type: "select", options: ["document", "certificate"] },
    { key: "filename", label: "File name", placeholder: "certificate-{{student_name}}" },
  ] },
  generate_report: { icon: "📊", label: "Generate report", group: "Reports", desc: "Generate a saved report (data only from real sources).", fields: [
    { key: "report_id", label: "Report ID", required: true },
    { key: "email_to", label: "Email to (optional)" },
  ] },
  notification: { icon: "🔔", label: "Notification", group: "Other", desc: "In-app (and optional email) notification.", fields: [
    { key: "title", label: "Title", required: true },
    { key: "body", label: "Body", type: "textarea" },
    { key: "severity", label: "Severity", type: "select", options: ["info", "success", "warning", "error"] },
    { key: "email", label: "Also email to" },
  ] },
};

export const VARIABLES = ["name", "email", "phone", "website", "category", "city", "lead_score", "service", "pitch", "rating"];

export const COND_OPS: { id: ConditionOp; label: string }[] = [
  { id: "equals", label: "equals" }, { id: "not_equals", label: "not equals" }, { id: "contains", label: "contains" },
  { id: "not_contains", label: "does not contain" }, { id: "gt", label: ">" }, { id: "lt", label: "<" },
  { id: "gte", label: "≥" }, { id: "lte", label: "≤" }, { id: "exists", label: "exists" }, { id: "empty", label: "is empty" },
];

/** Integrations a definition needs (for status checks & disabling execution). */
export function requiredIntegrations(def: Definition): string[] {
  const s = new Set<string>(TRIGGERS[def.trigger?.type]?.requires || []);
  for (const n of def.steps || []) {
    for (const r of ACTIONS[n.type]?.requires || []) s.add(r);
    if (n.type === "maps_search" && n.config.source === "google") s.add("google_places");
  }
  return [...s];
}

/** Parse "lead_score:number, priority:enum(A|B), pitch:string". */
export type OutField = { name: string; type: "string" | "number" | "boolean" | "enum" | "array"; options?: string[] };
export function parseOutputs(spec: string): OutField[] {
  return (spec || "").split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, rawType = "string"] = s.split(":").map((x) => x.trim());
    const m = rawType.match(/^enum\((.*)\)$/i);
    if (m) return { name, type: "enum", options: m[1].split("|").map((x) => x.trim()).filter(Boolean) };
    const t = rawType.toLowerCase();
    return { name, type: (["number", "boolean", "array"].includes(t) ? t : "string") as OutField["type"] };
  });
}

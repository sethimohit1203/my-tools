// Ready-made workflow templates. Using one creates a real (draft) workflow;
// fill the highlighted settings (sheet IDs, template names…) and activate.
import type { Definition, Node } from "./types";

export type Template = { key: string; name: string; business: string; desc: string; setup: string[]; definition: Definition };

const n = (key: string, type: Node["type"], name: string, config: Record<string, unknown> = {}): Node => ({ key, type, name, config });
const f = (o: Record<string, string>) => Object.entries(o).map(([key, value]) => ({ key, value }));

const LEAD_FIELDS = f({ name: "{{name}}", category: "{{category}}", phone: "{{phone}}", email: "{{email}}", website: "{{website}}", address: "{{address}}", city: "{{city}}", rating: "{{rating}}", reviews: "{{reviews}}", maps_link: "{{maps_link}}", source_ref: "{{source_ref}}", lead_score: "{{lead_score}}", temperature: "{{temperature}}", website_score: "{{website_score}}", seo_score: "{{seo_score}}", social_score: "{{social_score}}", recommended_service: "{{recommended_service}}", opportunities: "{{opportunities}}", profile: "designoia", source: "Maps workflow" });

export const TEMPLATES: Template[] = [
  {
    key: "maps_to_crm", name: "Maps Lead → CRM", business: "Designoia",
    desc: "Find businesses for a keyword + area and add each one to the CRM with a basic lead score.",
    setup: ["Run it manually with input like {\"query\":\"cafes\",\"location\":\"Laxmi Nagar, Delhi\"}"],
    definition: { trigger: { type: "manual", config: {} }, settings: { sampleInput: JSON.stringify({ query: "cafes", location: "Laxmi Nagar, Delhi", city: "Delhi" }) }, steps: [
      n("find", "maps_search", "Find businesses", { query: "{{query}}", location: "{{location}}", radius_m: 3000, limit: 40, source: "osm" }),
      n("each", "loop", "For each business", { items: "steps.find.results" }),
      n("score", "lead_score", "Calculate lead score"),
      n("save", "create_lead", "Add to CRM", { fields: LEAD_FIELDS }),
    ] },
  },
  {
    key: "maps_website_audit", name: "Maps Lead → Website Audit", business: "Designoia",
    desc: "Find businesses, audit every website (speed, mobile, SEO, WhatsApp, forms) and save scored leads.",
    setup: ["Input: {\"query\":\"…\",\"location\":\"…\"}"],
    definition: { trigger: { type: "manual", config: {} }, settings: { sampleInput: JSON.stringify({ query: "dentists", location: "Preet Vihar, Delhi", city: "Delhi" }) }, steps: [
      n("find", "maps_search", "Find businesses", { query: "{{query}}", location: "{{location}}", radius_m: 3000, limit: 30, source: "osm" }),
      n("each", "loop", "For each business", { items: "steps.find.results" }),
      n("audit", "website_audit", "Audit website", { url: "{{website}}" }),
      n("score", "lead_score", "Calculate lead score", { audit_step: "audit" }),
      n("save", "create_lead", "Add to CRM", { fields: LEAD_FIELDS }),
    ] },
  },
  {
    key: "designoia_pipeline", name: "Designoia: Find → Audit → Score → AI pitch → CRM", business: "Designoia",
    desc: "The full Designoia pipeline: business search, website check, lead score, AI service recommendation & personalised pitch, saved to CRM; HOT leads trigger a notification.",
    setup: ["Configure AI in Integrations", "Input: {\"query\":\"…\",\"location\":\"…\"}", "Optional: add a WhatsApp/Email step or start a campaign for HOT leads"],
    definition: { trigger: { type: "manual", config: {} }, settings: { sampleInput: JSON.stringify({ query: "coaching centres", location: "Laxmi Nagar, Delhi", city: "Delhi" }) }, steps: [
      n("find", "maps_search", "Find businesses", { query: "{{query}}", location: "{{location}}", radius_m: 3000, limit: 30, source: "osm" }),
      n("each", "loop", "For each business", { items: "steps.find.results" }),
      n("audit", "website_audit", "Website analyzer", { url: "{{website}}" }),
      n("score", "lead_score", "Lead score + service", { audit_step: "audit" }),
      n("ai", "ai_analyze", "AI analysis & pitch", { instruction: "You are a sales strategist for Designoia (web design, SEO, social media, Google Ads, WhatsApp automation) in India. Using ONLY this business data, recommend the best service package and write a short personalised opening line. Website missing → Website Development; poor SEO → SEO; weak social → Social Media Management; no ads/lead capture → Ads Management; several gaps → a bundled package.", outputs: "recommended_service:string, pitch:string, priority:enum(HIGH|MEDIUM|LOW), estimate_inr:string" }),
      n("save", "create_lead", "Add to CRM", { fields: [...LEAD_FIELDS.filter((x) => x.key !== "recommended_service"), { key: "recommended_service", value: "{{recommended_service}}" }, { key: "pitch", value: "{{pitch}}" }] }),
      n("hot", "condition", "Only HOT leads", { rules: [{ left: "lead_score", op: "gte", right: "70" }], combinator: "and", onFalse: "stop" }),
      n("ping", "notification", "Notify me", { title: "🔥 HOT lead: {{name}}", body: "{{recommended_service}} — {{pitch}}", severity: "success" }),
    ] },
  },
  {
    key: "maps_ai_score", name: "Maps Lead → AI Lead Score", business: "Designoia",
    desc: "AI classifies each found business HOT/WARM/COLD with reasons and budget estimate.",
    setup: ["Configure AI", "Input: {\"query\":\"…\",\"location\":\"…\"}"],
    definition: { trigger: { type: "manual", config: {} }, settings: { sampleInput: JSON.stringify({ query: "salons", location: "Mayur Vihar, Delhi" }) }, steps: [
      n("find", "maps_search", "Find businesses", { query: "{{query}}", location: "{{location}}", limit: 25 }),
      n("each", "loop", "For each", { items: "steps.find.results" }),
      n("ai", "ai_analyze", "AI lead score", { instruction: "Score this business as a lead for a web/SEO agency using only its data.", outputs: "lead_score:number, temperature:enum(HOT|WARM|COLD), recommended_service:string, reason:string" }),
      n("save", "create_lead", "Add to CRM", { fields: f({ name: "{{name}}", category: "{{category}}", phone: "{{phone}}", website: "{{website}}", address: "{{address}}", source_ref: "{{source_ref}}", lead_score: "{{lead_score}}", temperature: "{{temperature}}", recommended_service: "{{recommended_service}}", notes: "{{reason}}", source: "AI lead score" }) }),
    ] },
  },
  {
    key: "lead_email_followup", name: "New Lead → Email + Follow-up", business: "Designoia",
    desc: "When a lead with an email is created: AI writes a personal email, sends it, marks the lead Contacted, and follows up after 3 days. (For larger sequences use Email Campaigns.)",
    setup: ["Connect Gmail, SMTP or Resend", "Configure AI"],
    definition: { trigger: { type: "new_lead", config: { filter: [{ left: "email", op: "exists" }] } }, steps: [
      n("write", "ai_generate", "AI writes email", { prompt: "Write a short (80-word), friendly cold email from Designoia to {{name}} ({{category}}, {{city}}). Mention: {{recommended_service}}. Plain text, no subject line, sign off as Team Designoia." }),
      n("send", "send_email", "Send email", { to: "{{email}}", subject: "Quick idea for {{name}}", body: "{{steps.write.text}}" }),
      n("mark", "update_lead", "Mark contacted", { match: "id", value: "{{lead_id}}", fields: f({ stage: "Contacted" }) }),
      n("wait", "delay", "Wait 3 days", { amount: 3, unit: "days" }),
      n("follow", "send_email", "Follow-up", { to: "{{email}}", subject: "Re: Quick idea for {{name}}", body: "Hi again — just checking if you saw my note about {{recommended_service}}. Happy to share a free audit.\n\nTeam Designoia" }),
    ] },
  },
  {
    key: "lead_whatsapp_followup", name: "New Lead → WhatsApp Follow-up", business: "Designoia",
    desc: "HOT leads with a phone number get an approved WhatsApp template, then a follow-up template after 2 days.",
    setup: ["Connect WhatsApp Cloud API", "Set your approved template names in both WhatsApp steps"],
    definition: { trigger: { type: "new_lead", config: { filter: [{ left: "phone", op: "exists" }, { left: "lead_score", op: "gte", right: "70" }] } }, steps: [
      n("intro", "send_whatsapp", "Intro template", { to: "{{phone}}", template: "YOUR_APPROVED_TEMPLATE", language: "en", params: "{{name}}, {{recommended_service}}" }),
      n("mark", "update_lead", "Mark contacted", { match: "id", value: "{{lead_id}}", fields: f({ stage: "Contacted" }) }),
      n("wait", "delay", "Wait 2 days", { amount: 2, unit: "days" }),
      n("follow", "send_whatsapp", "Follow-up template", { to: "{{phone}}", template: "YOUR_FOLLOWUP_TEMPLATE", language: "en", params: "{{name}}" }),
    ] },
  },
  {
    key: "sheet_ai", name: "Google Sheet → AI Processing", business: "All",
    desc: "Every new row is analysed by AI and the results are written back into the same row.",
    setup: ["Connect Google", "Set spreadsheet + worksheet in the trigger and in “Write back”", "Edit the AI instruction/outputs"],
    definition: { trigger: { type: "sheets_new_row", config: { spreadsheet_id: "", sheet: "Sheet1" } }, steps: [
      n("ai", "ai_analyze", "AI analyze", { instruction: "Analyse this row.", outputs: "category:string, priority:enum(HIGH|MEDIUM|LOW), summary:string" }),
      n("write", "sheets_write", "Write back", { spreadsheet_id: "", sheet: "Sheet1", mode: "update", key_column: "_row", row: f({ Category: "{{category}}", Priority: "{{priority}}", Summary: "{{summary}}" }) }),
    ] },
  },
  {
    key: "sheet_lead_scoring", name: "Google Sheet → Lead score → CRM (HOT > 80)", business: "Designoia",
    desc: "New row → validate → AI analyze → lead score into sheet → if score > 80 create CRM lead with pitch and follow-up date.",
    setup: ["Connect Google + AI", "Sheet columns: Name, Phone, Email, Website, Category, City"],
    definition: { trigger: { type: "sheets_new_row", config: { spreadsheet_id: "", sheet: "Leads" } }, steps: [
      n("valid", "condition", "Has a name", { rules: [{ left: "Name", op: "exists" }], onFalse: "stop" }),
      n("ai", "ai_analyze", "AI analyze", { instruction: "Score this business as a Designoia lead using only the row data.", outputs: "lead_score:number, recommended_service:string, pitch:string" }),
      n("write", "sheets_write", "Update sheet", { spreadsheet_id: "", sheet: "Leads", mode: "update", key_column: "_row", row: f({ "Lead Score": "{{lead_score}}", Service: "{{recommended_service}}" }) }),
      n("hot", "condition", "Score > 80", { rules: [{ left: "lead_score", op: "gt", right: "80" }], onFalse: "stop" }),
      n("lead", "create_lead", "Create CRM lead", { fields: f({ name: "{{Name}}", phone: "{{Phone}}", email: "{{Email}}", website: "{{Website}}", category: "{{Category}}", city: "{{City}}", lead_score: "{{lead_score}}", recommended_service: "{{recommended_service}}", pitch: "{{pitch}}", next_follow_up: "{{today}}", source: "Google Sheet", source_ref: "sheet:{{spreadsheet_id}}:{{row_key}}" }) }),
    ] },
  },
  {
    key: "sheet_wordpress", name: "Google Sheet → WordPress", business: "Designoia / ProRido",
    desc: "Each new row (Topic, Keyword, Image URL) becomes an AI-written WordPress draft with SEO meta, schema and featured image; link written back. Never duplicates.",
    setup: ["Connect Google, AI and WordPress", "Columns: Topic, Keyword, Image URL"],
    definition: { trigger: { type: "sheets_new_row", config: { spreadsheet_id: "", sheet: "Content" } }, steps: [
      n("ai", "ai_analyze", "AI article", { instruction: "Write an SEO blog post (~900 words) for the topic and keyword in this row. html = article body using h2/h3/p/ul only.", outputs: "title:string, html:string, seo_title:string, meta_description:string" }),
      n("wp", "wordpress", "Create WordPress draft", { operation: "create_post", external_id: "sheet:{{spreadsheet_id}}:{{row_key}}", title: "{{title}}", content: "{{html}}", status: "draft", featured_image_url: "{{Image URL}}", seo_title: "{{seo_title}}", seo_description: "{{meta_description}}", focus_keyword: "{{Keyword}}", schema: "{\"@context\":\"https://schema.org\",\"@type\":\"Article\",\"headline\":\"{{title}}\"}" }),
      n("back", "sheets_write", "Write link back", { spreadsheet_id: "", sheet: "Content", mode: "update", key_column: "_row", row: f({ Status: "Draft created", "Post ID": "{{steps.wp.id}}", Link: "{{steps.wp.link}}" }) }),
    ] },
  },
  {
    key: "ai_content_wordpress", name: "AI Content → WordPress (weekly)", business: "Designoia / ProRido",
    desc: "Every week AI writes a post on your topic list and saves it as a WordPress draft for review.",
    setup: ["Connect AI + WordPress", "Edit the schedule input topics"],
    definition: { trigger: { type: "schedule", config: { kind: "weekly", day_of_week: 1, at_time: "09:00", timezone: "Asia/Kolkata", input: JSON.stringify([{ topic: "Why every local business needs a website in 2026", keyword: "website for small business" }]) } }, steps: [
      n("ai", "ai_analyze", "AI article", { instruction: "Write an SEO blog post for this topic and keyword. html uses h2/h3/p/ul.", outputs: "title:string, html:string, meta_description:string" }),
      n("wp", "wordpress", "WordPress draft", { operation: "create_post", external_id: "weekly:{{today}}:{{keyword}}", title: "{{title}}", content: "{{html}}", status: "draft", seo_description: "{{meta_description}}", focus_keyword: "{{keyword}}" }),
      n("ping", "notification", "Notify", { title: "New draft: {{title}}", body: "{{steps.wp.link}}" }),
    ] },
  },
  {
    key: "wordpress_seo_report", name: "WordPress → SEO Report", business: "Designoia",
    desc: "When WordPress publishes a post (via WP Webhooks plugin), audit the new URL and get an AI SEO review.",
    setup: ["Activate to create the webhook", "In WordPress (WP Webhooks plugin) send post_published to the webhook URL with the post link as \"link\""],
    definition: { trigger: { type: "wordpress_event", config: { event: "" } }, steps: [
      n("audit", "website_audit", "Audit the post", { url: "{{link}}" }),
      n("ai", "ai_generate", "AI SEO review", { prompt: "Review this blog post's SEO using ONLY this audit data and list the top 5 fixes: score {{steps.audit.score}}, SEO {{steps.audit.seo}}, failed checks {{steps.audit.failed_checks}}." }),
      n("ping", "notification", "Send review", { title: "SEO review: {{link}}", body: "{{steps.ai.text}}" }),
    ] },
  },
  {
    key: "site_monitor_alerts", name: "Website → SEO Monitor alerts", business: "All",
    desc: "When any monitor detects downtime or a significant SEO change, email the alert and log it to a sheet.",
    setup: ["Add websites in Website / SEO Monitor", "Connect email (and Google for the log)"],
    definition: { trigger: { type: "monitor_event", config: { event: "any" } }, steps: [
      n("mail", "send_email", "Email alert", { to: "you@example.com", subject: "[Monitor] {{label}}: {{event}}", body: "{{change}}\n{{url}}" }),
      n("log", "sheets_write", "Log to sheet", { spreadsheet_id: "", sheet: "Monitor log", mode: "append", row: f({ Date: "{{now}}", Site: "{{label}}", Event: "{{event}}", Change: "{{change}}" }) }),
    ] },
  },
  {
    key: "competitor_monitor", name: "Competitor → Website Monitor", business: "Designoia / InnBly",
    desc: "When a competitor adds pages, AI summarises what changed and you get notified.",
    setup: ["Add competitor sites in Website / SEO Monitor (type: competitor, sitemap tracking on)", "Configure AI"],
    definition: { trigger: { type: "monitor_event", config: { event: "new_page" } }, steps: [
      n("ai", "ai_generate", "AI summary", { prompt: "A competitor ({{label}}) added new pages: {{change}}. In 3 bullets, what might they be targeting and how should we respond? Use only this information." }),
      n("ping", "notification", "Notify", { title: "Competitor update: {{label}}", body: "{{steps.ai.text}}", severity: "warning" }),
    ] },
  },
  {
    key: "col_attendance", name: "COL Attendance → Report & parent alert", business: "COL",
    desc: "Daily: read the attendance sheet, calculate each student's %, write it back, and alert parents below 75%.",
    setup: ["Connect Google (+ WhatsApp for parent alerts)", "Sheet columns: Student, Parent Phone, Present, Total", "Set your approved WhatsApp template"],
    definition: { trigger: { type: "schedule", config: { kind: "daily", at_time: "18:00", timezone: "Asia/Kolkata", input: "[{}]" } }, steps: [
      n("read", "sheets_read", "Read attendance", { spreadsheet_id: "", sheet: "Attendance" }),
      n("each", "loop", "For each student", { items: "steps.read.rows" }),
      n("calc", "transform", "Attendance %", { fields: f({ percentage: "=round({{Present}}/{{Total}}*100, 1)" }) }),
      n("write", "sheets_write", "Write %", { spreadsheet_id: "", sheet: "Attendance", mode: "update", key_column: "_row", row: f({ "Attendance %": "{{percentage}}" }) }),
      n("low", "condition", "Below 75%", { rules: [{ left: "percentage", op: "lt", right: "75" }], onFalse: "stop" }),
      n("alert", "send_whatsapp", "Notify parent", { to: "{{Parent Phone}}", template: "YOUR_ATTENDANCE_TEMPLATE", language: "en", params: "{{Student}}, {{percentage}}" }),
    ] },
  },
  {
    key: "col_results", name: "COL Results → Student Report", business: "COL",
    desc: "New marks row → percentage → AI grade, strengths and remark → written back to the sheet.",
    setup: ["Connect Google + AI", "Columns: Student, Maths, Science, English, Max (per subject)"],
    definition: { trigger: { type: "sheets_new_row", config: { spreadsheet_id: "", sheet: "Results" } }, steps: [
      n("calc", "transform", "Percentage", { fields: f({ total: "={{Maths}}+{{Science}}+{{English}}", percentage: "=round(({{Maths}}+{{Science}}+{{English}})/({{Max}}*3)*100, 1)" }) }),
      n("ai", "ai_analyze", "Grade & remark", { instruction: "You are a teacher at Circle of Learning. Using only these marks and percentage, grade the student (A+ 90+, A 80+, B 70+, C 60+, D 50+, E below) and write an encouraging remark.", outputs: "grade:enum(A+|A|B|C|D|E), strength:string, improve:string, remark:string" }),
      n("write", "sheets_write", "Write report", { spreadsheet_id: "", sheet: "Results", mode: "update", key_column: "_row", row: f({ Total: "{{total}}", "%": "{{percentage}}", Grade: "{{grade}}", Strength: "{{strength}}", Improve: "{{improve}}", Remark: "{{remark}}" }) }),
    ] },
  },
  {
    key: "col_certificates", name: "COL Certificates", business: "COL",
    desc: "New row (Student, Course, Date, Email) → validated → certificate PDF stored → link written back and emailed.",
    setup: ["Connect Google + email", "Supabase Storage (SUPABASE_SERVICE_ROLE_KEY) for PDF links"],
    definition: { trigger: { type: "sheets_new_row", config: { spreadsheet_id: "", sheet: "Certificates" } }, steps: [
      n("valid", "condition", "Has student + course", { rules: [{ left: "Student", op: "exists" }, { left: "Course", op: "exists" }], combinator: "and", onFalse: "stop" }),
      n("pdf", "generate_pdf", "Certificate PDF", { title: "Certificate of Completion", body: "This is to certify that\n{{Student}}\nhas successfully completed\n{{Course}}\non {{Date}} at Circle of Learning.", layout: "certificate", filename: "certificate-{{Student}}" }),
      n("back", "sheets_write", "Write link", { spreadsheet_id: "", sheet: "Certificates", mode: "update", key_column: "_row", row: f({ Certificate: "{{steps.pdf.url}}" }) }),
      n("mail", "send_email", "Email student", { to: "{{Email}}", subject: "Your certificate — {{Course}}", body: "Congratulations {{Student}}! Download your certificate: {{steps.pdf.url}}\n\nCircle of Learning" }),
    ] },
  },
  {
    key: "col_question_paper", name: "COL Question Paper Generator", business: "COL",
    desc: "Class + subject + chapter + difficulty → AI paper → structure validated → PDF.",
    setup: ["Configure AI", "Run with input {\"class\":\"8\",\"subject\":\"Science\",\"chapter\":\"Light\",\"difficulty\":\"medium\",\"marks\":40}"],
    definition: { trigger: { type: "manual", config: {} }, settings: { sampleInput: JSON.stringify({ class: "8", subject: "Science", chapter: "Light", difficulty: "medium", marks: 40 }) }, steps: [
      n("paper", "ai_analyze", "AI question paper", { instruction: "Create a CBSE-style question paper for Class {{class}} {{subject}}, chapter {{chapter}}, {{difficulty}} difficulty, total {{marks}} marks. Sections A (MCQ), B (short), C (long), marks shown per question. paper = full paper text with line breaks.", outputs: "paper:string, total_marks:number, question_count:number" }),
      n("check", "condition", "Marks add up", { rules: [{ left: "total_marks", op: "equals", right: "{{marks}}" }], onFalse: "stop" }),
      n("pdf", "generate_pdf", "PDF", { title: "Class {{class}} {{subject}} — {{chapter}}", body: "{{paper}}", layout: "document", filename: "paper-{{class}}-{{subject}}-{{chapter}}" }),
      n("ping", "notification", "Ready", { title: "Question paper ready: {{subject}} {{chapter}}", body: "{{steps.pdf.url}}" }),
    ] },
  },
  {
    key: "clikixpress_catalog", name: "ClikiXpress Product → AI Catalog", business: "ClikiXpress",
    desc: "New product row → AI title, description, bullets, category, SEO metadata → written back for the catalog.",
    setup: ["Connect Google + AI", "Columns: Product, Brand, Price, Image URL"],
    definition: { trigger: { type: "sheets_new_row", config: { spreadsheet_id: "", sheet: "Products" } }, steps: [
      n("ai", "ai_analyze", "AI listing", { instruction: "Write e-commerce listing content for this product for Indian shoppers, using only the row data.", outputs: "seo_title:string, description:string, bullets:string, category:string, meta_description:string, keywords:string" }),
      n("write", "sheets_write", "Write catalog fields", { spreadsheet_id: "", sheet: "Products", mode: "update", key_column: "_row", row: f({ "SEO Title": "{{seo_title}}", Description: "{{description}}", Bullets: "{{bullets}}", Category: "{{category}}", "Meta Description": "{{meta_description}}", Keywords: "{{keywords}}" }) }),
    ] },
  },
  {
    key: "clikixpress_suppliers", name: "ClikiXpress Supplier Finder", business: "ClikiXpress",
    desc: "Search wholesalers, keep contactable ones, score them and save as supplier leads.",
    setup: ["Configure AI", "Input: {\"query\":\"mobile accessories wholesalers\",\"location\":\"Karol Bagh, Delhi\"}"],
    definition: { trigger: { type: "manual", config: {} }, settings: { sampleInput: JSON.stringify({ query: "mobile accessories wholesalers", location: "Karol Bagh, Delhi" }) }, steps: [
      n("find", "maps_search", "Find suppliers", { query: "{{query}}", location: "{{location}}", limit: 40, radius_m: 5000 }),
      n("each", "loop", "For each", { items: "steps.find.results" }),
      n("contact", "condition", "Has phone", { rules: [{ left: "phone", op: "exists" }], onFalse: "stop" }),
      n("score", "ai_analyze", "Supplier score", { instruction: "Score this business as a potential supplier for ClikiXpress (an Indian e-commerce store) using only its data: wholesale/distributor signals, contactability, website, rating.", outputs: "lead_score:number, reason:string" }),
      n("save", "create_lead", "Save supplier", { fields: f({ name: "{{name}}", category: "{{category}}", phone: "{{phone}}", website: "{{website}}", address: "{{address}}", source_ref: "{{source_ref}}", lead_score: "{{lead_score}}", notes: "{{reason}}", profile: "clikixpress", source: "Supplier finder" }) }),
    ] },
  },
  {
    key: "innbly_listing", name: "InnBly Property → AI Listing", business: "InnBly",
    desc: "New property row → AI listing description, amenities, SEO meta → WordPress page draft → link back.",
    setup: ["Connect Google, AI, WordPress", "Columns: Property, City, Rooms, Price, Amenities, Image URL"],
    definition: { trigger: { type: "sheets_new_row", config: { spreadsheet_id: "", sheet: "Properties" } }, steps: [
      n("ai", "ai_analyze", "AI listing", { instruction: "Write a booking-page listing for this property using only the row data. html uses h2/p/ul.", outputs: "title:string, html:string, amenities:string, seo_title:string, meta_description:string" }),
      n("wp", "wordpress", "Create page draft", { operation: "create_page", external_id: "property:{{spreadsheet_id}}:{{row_key}}", title: "{{title}}", content: "{{html}}", status: "draft", featured_image_url: "{{Image URL}}", seo_title: "{{seo_title}}", seo_description: "{{meta_description}}" }),
      n("back", "sheets_write", "Write link", { spreadsheet_id: "", sheet: "Properties", mode: "update", key_column: "_row", row: f({ Listing: "{{steps.wp.link}}", Amenities: "{{amenities}}" }) }),
    ] },
  },
  {
    key: "innbly_inquiry", name: "InnBly Booking Inquiry → CRM → WhatsApp", business: "InnBly",
    desc: "Booking form posts to the webhook → validated → CRM lead → WhatsApp confirmation → follow-up next day.",
    setup: ["Activate to get the webhook URL; post {name, phone, email, property, dates}", "Set approved WhatsApp templates"],
    definition: { trigger: { type: "webhook", config: {} }, steps: [
      n("valid", "condition", "Has phone", { rules: [{ left: "phone", op: "exists" }, { left: "name", op: "exists" }], combinator: "and", onFalse: "stop" }),
      n("lead", "create_lead", "CRM lead", { fields: f({ name: "{{name}}", phone: "{{phone}}", email: "{{email}}", profile: "innbly", source: "Booking inquiry", notes: "{{property}} — {{dates}}", stage: "Interested" }) }),
      n("wa", "send_whatsapp", "Confirm by WhatsApp", { to: "{{phone}}", template: "YOUR_BOOKING_TEMPLATE", language: "en", params: "{{name}}, {{property}}" }),
      n("ping", "notification", "Notify team", { title: "New booking inquiry: {{name}}", body: "{{property}} {{dates}}" }),
      n("wait", "delay", "Next day", { amount: 1, unit: "days" }),
      n("follow", "send_whatsapp", "Follow-up", { to: "{{phone}}", template: "YOUR_FOLLOWUP_TEMPLATE", language: "en", params: "{{name}}" }),
    ] },
  },
  {
    key: "monthly_seo_report", name: "Monthly Client SEO Report", business: "Designoia",
    desc: "On the 1st of every month generate the client's SEO report (audit + Search Console + GA4 + AI) and email the PDF.",
    setup: ["Create the report in Report Automation and paste its ID", "Connect email (+ Google for GSC/GA)"],
    definition: { trigger: { type: "schedule", config: { kind: "monthly", day_of_month: 1, at_time: "09:00", timezone: "Asia/Kolkata", input: "[{}]" } }, steps: [
      n("report", "generate_report", "Generate report", { report_id: "", email_to: "client@example.com" }),
    ] },
  },
];

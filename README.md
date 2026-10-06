# My Tools

AI-powered tools for SEO, WordPress, lead generation and automation (COL, Designoia, ClikiXpress, InnBly, ProRido). Next.js 16 app router, deployed on Vercel.

```bash
npm install
npm run dev   # http://localhost:3000
```

## Tools

**Business Growth OS** — `/gmaps` Lead Finder & Scorer · `/crm` Lead CRM & follow-ups · `/local-seo` Local SEO & competitor analyzer · `/proposal` Proposal generator

**SEO & content** — `/seo-audit` Website analyzer · `/keywords` Keyword researcher · `/content-planner` · `/blog-gen` · `/internal-links` · `/schema` · `/image-seo` · `/wp-api` WordPress AI tool · `/backlinks`

**Automation** — `/automation` Workflow builder + webhooks · `/sheets-automation` · `/ai-processor` · `/outreach?ch=email|whatsapp` · `/social` · `/wp-automation` · `/monitor` Website/SEO monitor · `/reports`

## Configuration

Every key can be entered in the app at **⚙ Settings** (stored in that browser only), or set as Vercel environment variables:

| Variable | Used for |
|---|---|
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | AI features (pick the provider in Settings) |
| `GOOGLE_PLACES_API_KEY` | Google Places source in Lead Finder / Local SEO (OpenStreetMap works without a key) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Sending email (proposals, outreach, reports, alerts) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | WhatsApp Business Cloud API (otherwise wa.me links are used) |
| `WP_URL`, `WP_USER`, `WP_APP_PASSWORD` | WordPress tools |
| `SHEETS_WEBHOOK_URL` | Writing to Google Sheets via the Apps Script shown in Sheets Automation |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) | Webhook & daily-schedule workflow triggers (Vercel → Storage → Upstash Redis) |
| `CRON_SECRET` | Optional: protects `/api/cron` (Vercel sends it automatically) |

`vercel.json` runs `/api/cron` once a day (09:00 IST) for scheduled workflows.

## Notes

- Maps search: OpenStreetMap queries run from the visitor's browser (Nominatim/Photon to find the place, Overpass for businesses in the radius), with `/api/osm` as a server fallback. Google data comes only from the official Places API.
- WhatsApp: only the official Cloud API is used; first messages outside a 24-hour window need a Meta-approved template.
- CRM, campaigns, monitors and settings live in the browser's localStorage — export CSV or sync to Sheets for backup and sharing.

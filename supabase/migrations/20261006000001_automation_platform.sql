-- My Tools automation platform — core schema.
-- Run in Supabase: SQL editor → paste → Run (or `supabase db push`).
-- All access goes through the app's server (service connection); RLS is
-- enabled so the anon/public API key can never read these tables directly.

-- ── Workspaces ─────────────────────────────────────────────────────────
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  email text,
  role text not null default 'owner' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on workspace_members(user_id);

-- ── Integrations (secrets are AES-256-GCM encrypted by the server) ─────
create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  config jsonb not null default '{}',
  secrets text,
  status text not null default 'not_configured' check (status in ('not_configured','connected','error','expired')),
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

-- ── Workflows ──────────────────────────────────────────────────────────
create table if not exists automation_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  type text not null default 'custom',
  status text not null default 'draft' check (status in ('draft','active','paused','running','completed','partially_completed','failed','cancelled')),
  trigger_type text not null default 'manual',
  definition jsonb not null default '{}',
  version int not null default 0,
  n8n_workflow_id text,
  template_key text,
  created_by uuid,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_workflows_ws_idx on automation_workflows(workspace_id, status);
create index if not exists automation_workflows_trigger_idx on automation_workflows(trigger_type, status);

create table if not exists automation_workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references automation_workflows(id) on delete cascade,
  version int not null,
  definition jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (workflow_id, version)
);

create table if not exists automation_nodes (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references automation_workflows(id) on delete cascade,
  version int not null,
  node_key text not null,
  kind text not null check (kind in ('trigger','action','condition')),
  type text not null,
  name text not null default '',
  config jsonb not null default '{}',
  position int not null default 0,
  unique (workflow_id, version, node_key)
);

-- ── Runs ───────────────────────────────────────────────────────────────
create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workflow_id uuid references automation_workflows(id) on delete set null,
  workflow_version int,
  workflow_name text,
  kind text not null default 'workflow',
  trigger text not null default 'manual',
  status text not null default 'queued' check (status in ('queued','running','paused','completed','partially_completed','failed','cancelled')),
  is_test boolean not null default false,
  input jsonb,
  output jsonb,
  error text,
  retry_count int not null default 0,
  records_total int not null default 0,
  records_success int not null default 0,
  records_failed int not null default 0,
  records_skipped int not null default 0,
  parent_run_id uuid references automation_runs(id) on delete set null,
  idempotency_key text,
  dispatched_at timestamptz,
  dispatch_error text,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms int,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_runs_ws_idx on automation_runs(workspace_id, created_at desc);
create index if not exists automation_runs_wf_idx on automation_runs(workflow_id, created_at desc);
create index if not exists automation_runs_status_idx on automation_runs(status);
create unique index if not exists automation_runs_idem_idx on automation_runs(workspace_id, idempotency_key) where idempotency_key is not null;

-- One row per record processed by a run (bulk workflows, campaign messages…).
create table if not exists automation_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references automation_runs(id) on delete cascade,
  workspace_id uuid not null,
  seq int not null,
  item_key text,
  input jsonb not null default '{}',
  context jsonb not null default '{}',
  output jsonb,
  status text not null default 'pending' check (status in ('pending','processing','waiting','success','failed','skipped','cancelled')),
  current_step int not null default 0,
  attempts int not null default 0,
  max_attempts int not null default 3,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, seq)
);
create index if not exists automation_run_items_claim_idx on automation_run_items(run_id, status, next_attempt_at);

create table if not exists automation_step_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references automation_runs(id) on delete cascade,
  item_id uuid references automation_run_items(id) on delete cascade,
  workspace_id uuid not null,
  node_key text not null,
  step_index int not null,
  step_type text not null,
  service text,
  status text not null check (status in ('success','failed','retrying','skipped','dry_run')),
  attempt int not null default 1,
  input jsonb,
  output jsonb,
  error text,
  http_status int,
  provider_response jsonb,
  recommended_action text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms int
);
create index if not exists automation_step_runs_run_idx on automation_step_runs(run_id, started_at);
create index if not exists automation_step_runs_item_idx on automation_step_runs(item_id);

create table if not exists automation_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workflow_id uuid not null references automation_workflows(id) on delete cascade,
  kind text not null check (kind in ('once','hourly','daily','weekly','monthly','interval')),
  interval_minutes int,
  at_time text,
  day_of_week int,
  day_of_month int,
  run_at timestamptz,
  timezone text not null default 'Asia/Kolkata',
  status text not null default 'active' check (status in ('active','paused')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_id uuid,
  n8n_workflow_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_id)
);
create index if not exists automation_schedules_due_idx on automation_schedules(status, next_run_at);

-- ── Webhook gateway ────────────────────────────────────────────────────
create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workflow_id uuid references automation_workflows(id) on delete cascade,
  name text not null default 'Webhook',
  method text not null default 'POST' check (method in ('POST','GET','ANY')),
  auth_mode text not null default 'api_key' check (auth_mode in ('api_key','hmac')),
  secret_enc text not null,
  secret_prefix text not null,
  status text not null default 'active' check (status in ('active','disabled')),
  rate_limit_per_min int not null default 60,
  max_body_kb int not null default 256,
  call_count int not null default 0,
  last_called_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists webhook_requests (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  workspace_id uuid not null,
  method text not null,
  headers jsonb,
  query jsonb,
  body jsonb,
  status_code int not null,
  error text,
  run_id uuid,
  ip text,
  received_at timestamptz not null default now()
);
create index if not exists webhook_requests_ep_idx on webhook_requests(endpoint_id, received_at desc);

-- ── Logs & notifications ───────────────────────────────────────────────
create table if not exists execution_logs (
  id bigserial primary key,
  workspace_id uuid not null,
  run_id uuid references automation_runs(id) on delete cascade,
  item_id uuid,
  level text not null default 'info' check (level in ('debug','info','warn','error')),
  service text,
  step text,
  message text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists execution_logs_run_idx on execution_logs(run_id, id);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null,
  severity text not null default 'info' check (severity in ('info','success','warning','error')),
  title text not null,
  body text,
  link text,
  dedupe_key text,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_ws_idx on notifications(workspace_id, created_at desc);
create unique index if not exists notifications_dedupe_idx on notifications(workspace_id, dedupe_key) where dedupe_key is not null;

-- ── Idempotency & rate limiting ────────────────────────────────────────
create table if not exists idempotency_keys (
  workspace_id uuid not null,
  scope text not null,
  key text not null,
  run_id uuid,
  status text not null default 'done',
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, scope, key)
);

create table if not exists rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

-- Atomically count a hit in a fixed window; returns true while under the limit.
create or replace function hit_rate_limit(p_key text, p_window_seconds int, p_max int)
returns boolean language plpgsql as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c int;
begin
  insert into rate_limit_counters(key, window_start, count) values (p_key, w, 1)
  on conflict (key, window_start) do update set count = rate_limit_counters.count + 1
  returning count into c;
  return c <= p_max;
end $$;

-- ── Leads (shared CRM) ─────────────────────────────────────────────────
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  business text,
  category text,
  phone text,
  email text,
  website text,
  address text,
  city text,
  rating numeric,
  reviews int,
  lead_score int,
  website_score int,
  seo_score int,
  social_score int,
  temperature text,
  recommended_service text,
  pitch text,
  opportunities text[] not null default '{}',
  stage text not null default 'New' check (stage in ('New','Qualified','Contacted','Interested','Meeting','Proposal','Negotiation','Won','Lost','Do Not Contact')),
  owner text,
  notes text,
  value numeric,
  profile text,
  source text,
  source_ref text,
  maps_link text,
  lat double precision,
  lng double precision,
  data jsonb not null default '{}',
  last_contacted_at timestamptz,
  next_follow_up date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_ws_idx on leads(workspace_id, created_at desc);
create unique index if not exists leads_source_ref_idx on leads(workspace_id, source_ref) where source_ref is not null;
create index if not exists leads_phone_idx on leads(workspace_id, phone);
create index if not exists leads_email_idx on leads(workspace_id, lower(email));

create table if not exists lead_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lead_id uuid not null references leads(id) on delete cascade,
  channel text not null,
  text text not null,
  created_at timestamptz not null default now()
);

-- ── Campaigns (email / WhatsApp) ───────────────────────────────────────
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('email','whatsapp')),
  mode text not null default 'api' check (mode in ('api','manual')),
  status text not null default 'draft' check (status in ('draft','active','paused','completed','cancelled','failed')),
  audience_filter jsonb not null default '{}',
  steps jsonb not null default '[]',
  settings jsonb not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists campaign_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  address text not null,
  vars jsonb not null default '{}',
  status text not null default 'active' check (status in ('active','replied','opted_out','unsubscribed','bounced','completed','stopped','failed')),
  current_step int not null default 0,
  next_send_at timestamptz,
  last_sent_at timestamptz,
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);
create index if not exists campaign_leads_addr_idx on campaign_leads(workspace_id, address, status);

create table if not exists campaign_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  campaign_lead_id uuid not null references campaign_leads(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  step_index int not null,
  channel text not null,
  to_address text not null,
  subject text,
  body text,
  template_name text,
  status text not null default 'queued' check (status in ('queued','sending','sent','delivered','read','failed','bounced','replied','opted_out','unsubscribed','cancelled')),
  provider text,
  provider_message_id text,
  provider_thread_id text,
  provider_response jsonb,
  error text,
  attempts int not null default 0,
  run_id uuid,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_lead_id, step_index)
);
create index if not exists campaign_messages_due_idx on campaign_messages(status, scheduled_for);
create index if not exists campaign_messages_provider_idx on campaign_messages(provider_message_id);

create table if not exists suppression_list (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel text not null check (channel in ('email','whatsapp','all')),
  address text not null,
  reason text not null,
  source text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, channel, address)
);

-- ── Social publishing ──────────────────────────────────────────────────
create table if not exists social_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform text not null,
  account text not null default 'default',
  caption text not null default '',
  hashtags text not null default '',
  media_urls text[] not null default '{}',
  topic text,
  scheduled_for timestamptz,
  status text not null default 'draft' check (status in ('draft','awaiting_approval','approved','scheduled','publishing','published','failed','cancelled')),
  approval_mode text not null default 'manual' check (approval_mode in ('manual','auto')),
  content_hash text not null,
  provider_post_id text,
  provider_url text,
  provider_response jsonb,
  error text,
  attempts int not null default 0,
  published_at timestamptz,
  run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform, account, content_hash)
);

-- ── WordPress publication registry (duplicate prevention) ──────────────
create table if not exists wp_publications (
  workspace_id uuid not null,
  site_url text not null,
  external_id text not null,
  post_id bigint,
  post_type text not null default 'posts',
  link text,
  status text,
  payload_hash text,
  generated jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, site_url, external_id)
);

-- ── Google Sheets trigger state ────────────────────────────────────────
create table if not exists sheet_row_state (
  workflow_id uuid not null references automation_workflows(id) on delete cascade,
  spreadsheet_id text not null,
  sheet_name text not null,
  row_key text not null,
  row_hash text not null,
  status text not null default 'queued',
  run_id uuid,
  updated_at timestamptz not null default now(),
  primary key (workflow_id, spreadsheet_id, sheet_name, row_key)
);
create table if not exists sheet_trigger_cursors (
  workflow_id uuid primary key references automation_workflows(id) on delete cascade,
  last_scan_at timestamptz,
  last_error text
);

-- ── Website / SEO monitor ──────────────────────────────────────────────
create table if not exists monitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  url text not null,
  label text,
  type text not null default 'full' check (type in ('uptime','seo','full','competitor')),
  frequency_minutes int not null default 1440,
  notify jsonb not null default '{"in_app": true, "email": false}',
  important_text text,
  track_sitemap boolean not null default true,
  status text not null default 'active' check (status in ('active','paused')),
  current_status text not null default 'unknown' check (current_status in ('up','down','unknown')),
  last_check_at timestamptz,
  next_check_at timestamptz not null default now(),
  last_change_at timestamptz,
  last_snapshot jsonb,
  ssl_expires_at timestamptz,
  checks_total int not null default 0,
  checks_up int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists monitor_checks (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references monitors(id) on delete cascade,
  workspace_id uuid not null,
  run_id uuid,
  checked_at timestamptz not null default now(),
  up boolean not null,
  http_status int,
  response_ms int,
  snapshot jsonb,
  changes jsonb not null default '[]',
  significant boolean not null default false,
  error text
);
create index if not exists monitor_checks_idx on monitor_checks(monitor_id, checked_at desc);

-- ── Reports ────────────────────────────────────────────────────────────
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  type text not null check (type in ('seo_monthly','website_audit','local_seo','lead','campaign','competitor')),
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists report_runs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  workspace_id uuid not null,
  run_id uuid,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  period_start date,
  period_end date,
  data jsonb,
  analysis jsonb,
  data_hash text,
  pdf_path text,
  emailed_to text,
  emailed_at timestamptz,
  warnings jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists report_runs_idx on report_runs(report_id, created_at desc);

-- ── Row level security: deny direct client access; the server uses a
-- privileged connection. Members may read their own workspace rows. ──
do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','workspace_members','integrations','automation_workflows','automation_workflow_versions',
    'automation_nodes','automation_runs','automation_run_items','automation_step_runs','automation_schedules',
    'webhook_endpoints','webhook_requests','execution_logs','notifications','idempotency_keys','rate_limit_counters',
    'leads','lead_activities','campaigns','campaign_leads','campaign_messages','suppression_list','social_posts',
    'wp_publications','sheet_row_state','sheet_trigger_cursors','monitors','monitor_checks','reports','report_runs'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Supabase Storage bucket for report PDFs (private). Skipped when the
-- storage schema doesn't exist (e.g. plain Postgres used for tests).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('reports', 'reports', false) on conflict (id) do nothing;
  end if;
end $$;

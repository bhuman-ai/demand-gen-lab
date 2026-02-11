create table if not exists demanddev_outreach_accounts (
  id text primary key,
  name text not null,
  provider text not null check (provider in ('customerio')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  config jsonb not null default '{}'::jsonb,
  credentials_encrypted text not null default '',
  last_test_at timestamptz,
  last_test_status text not null default 'unknown' check (last_test_status in ('unknown', 'pass', 'fail')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists demanddev_brand_outreach_assignments (
  brand_id text primary key references demanddev_brands(id) on delete cascade,
  account_id text not null references demanddev_outreach_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists demanddev_outreach_runs (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  campaign_id text not null references demanddev_campaigns(id) on delete cascade,
  experiment_id text not null,
  hypothesis_id text not null,
  account_id text not null references demanddev_outreach_accounts(id) on delete restrict,
  status text not null check (
    status in ('queued', 'preflight_failed', 'sourcing', 'scheduled', 'sending', 'monitoring', 'paused', 'completed', 'canceled', 'failed')
  ),
  cadence text not null default '3_step_7_day' check (cadence in ('3_step_7_day')),
  daily_cap integer not null default 30,
  hourly_cap integer not null default 6,
  timezone text not null default 'America/Los_Angeles',
  min_spacing_minutes integer not null default 8,
  pause_reason text not null default '',
  last_error text not null default '',
  external_ref text not null default '',
  metrics jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demanddev_outreach_runs_campaign_idx on demanddev_outreach_runs (campaign_id);
create index if not exists demanddev_outreach_runs_status_idx on demanddev_outreach_runs (status);

create table if not exists demanddev_outreach_run_leads (
  id text primary key,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  campaign_id text not null references demanddev_campaigns(id) on delete cascade,
  email text not null,
  name text not null default '',
  company text not null default '',
  title text not null default '',
  domain text not null default '',
  source_url text not null default '',
  status text not null default 'new' check (status in ('new', 'suppressed', 'scheduled', 'sent', 'replied', 'bounced', 'unsubscribed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists demanddev_outreach_run_leads_run_email_idx
  on demanddev_outreach_run_leads (run_id, lower(email));

create table if not exists demanddev_outreach_messages (
  id text primary key,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  campaign_id text not null references demanddev_campaigns(id) on delete cascade,
  lead_id text not null references demanddev_outreach_run_leads(id) on delete cascade,
  step integer not null,
  subject text not null,
  body text not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'failed', 'bounced', 'replied', 'canceled')),
  provider_message_id text not null default '',
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demanddev_outreach_messages_run_schedule_idx
  on demanddev_outreach_messages (run_id, status, scheduled_at);

create table if not exists demanddev_reply_threads (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  campaign_id text not null references demanddev_campaigns(id) on delete cascade,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  lead_id text not null references demanddev_outreach_run_leads(id) on delete cascade,
  subject text not null,
  sentiment text not null default 'neutral' check (sentiment in ('positive', 'neutral', 'negative')),
  status text not null default 'new' check (status in ('new', 'open', 'closed')),
  intent text not null default 'other' check (intent in ('question', 'interest', 'objection', 'unsubscribe', 'other')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists demanddev_reply_messages (
  id text primary key,
  thread_id text not null references demanddev_reply_threads(id) on delete cascade,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text not null default '',
  recipient text not null default '',
  subject text not null default '',
  body text not null default '',
  provider_message_id text not null default '',
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists demanddev_reply_drafts (
  id text primary key,
  thread_id text not null references demanddev_reply_threads(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  subject text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'dismissed')),
  reason text not null default '',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists demanddev_outreach_events (
  id text primary key,
  run_id text references demanddev_outreach_runs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists demanddev_outreach_events_run_idx on demanddev_outreach_events (run_id, created_at desc);

create table if not exists demanddev_outreach_job_queue (
  id text primary key,
  run_id text references demanddev_outreach_runs(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  execute_after timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  payload jsonb not null default '{}'::jsonb,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demanddev_outreach_job_queue_due_idx
  on demanddev_outreach_job_queue (status, execute_after);

create table if not exists demanddev_run_anomalies (
  id text primary key,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  type text not null check (type in ('hard_bounce_rate', 'spam_complaint_rate', 'provider_error_rate', 'negative_reply_rate_spike')),
  severity text not null check (severity in ('warning', 'critical')),
  status text not null default 'active' check (status in ('active', 'acknowledged', 'resolved')),
  threshold numeric not null,
  observed numeric not null,
  details text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demanddev_run_anomalies_run_idx on demanddev_run_anomalies (run_id, status);

drop trigger if exists demanddev_outreach_accounts_updated_at on demanddev_outreach_accounts;
create trigger demanddev_outreach_accounts_updated_at
before update on demanddev_outreach_accounts
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_brand_outreach_assignments_updated_at on demanddev_brand_outreach_assignments;
create trigger demanddev_brand_outreach_assignments_updated_at
before update on demanddev_brand_outreach_assignments
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_outreach_runs_updated_at on demanddev_outreach_runs;
create trigger demanddev_outreach_runs_updated_at
before update on demanddev_outreach_runs
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_outreach_run_leads_updated_at on demanddev_outreach_run_leads;
create trigger demanddev_outreach_run_leads_updated_at
before update on demanddev_outreach_run_leads
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_outreach_messages_updated_at on demanddev_outreach_messages;
create trigger demanddev_outreach_messages_updated_at
before update on demanddev_outreach_messages
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_reply_threads_updated_at on demanddev_reply_threads;
create trigger demanddev_reply_threads_updated_at
before update on demanddev_reply_threads
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_reply_drafts_updated_at on demanddev_reply_drafts;
create trigger demanddev_reply_drafts_updated_at
before update on demanddev_reply_drafts
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_outreach_job_queue_updated_at on demanddev_outreach_job_queue;
create trigger demanddev_outreach_job_queue_updated_at
before update on demanddev_outreach_job_queue
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_run_anomalies_updated_at on demanddev_run_anomalies;
create trigger demanddev_run_anomalies_updated_at
before update on demanddev_run_anomalies
for each row execute function demanddev_set_updated_at();

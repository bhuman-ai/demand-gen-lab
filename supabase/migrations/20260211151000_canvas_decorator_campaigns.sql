-- Decorator lead import + campaign automation tables.

do $$ begin
  create type canvas_decorator_lead_status as enum ('new', 'contacted', 'replied', 'do_not_contact', 'invalid');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_campaign_run_status as enum ('running', 'succeeded', 'failed');
exception when duplicate_object then null; end $$;
create table if not exists public.canvas_decorator_leads (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'apify',
  full_name text,
  email text,
  phone text,
  title text,
  company_name text,
  company_domain text,
  linkedin_url text,
  person_country text,
  person_state text,
  status canvas_decorator_lead_status not null default 'new',
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.canvas_decorator_campaign_runs (
  id uuid primary key default gen_random_uuid(),
  mode text,
  target text not null default 'us_interior_designers',
  dry_run boolean not null default false,
  status canvas_campaign_run_status not null default 'running',
  fetched integer not null default 0,
  eligible integer not null default 0,
  sent integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvas_decorator_campaign_runs_fetched_check check (fetched >= 0),
  constraint canvas_decorator_campaign_runs_eligible_check check (eligible >= 0),
  constraint canvas_decorator_campaign_runs_sent_check check (sent >= 0),
  constraint canvas_decorator_campaign_runs_skipped_check check (skipped >= 0),
  constraint canvas_decorator_campaign_runs_failed_check check (failed >= 0)
);
create table if not exists public.canvas_decorator_outreach_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.canvas_decorator_campaign_runs(id) on delete set null,
  lead_id uuid references public.canvas_decorator_leads(id) on delete set null,
  provider text not null default 'mailgun',
  provider_message_id text,
  status canvas_outreach_status not null default 'queued',
  subject text,
  sent_to text,
  reason text,
  error text,
  created_at timestamptz not null default now()
);
create unique index if not exists canvas_decorator_leads_email_key
  on public.canvas_decorator_leads(lower(email))
  where email is not null;
create index if not exists canvas_decorator_leads_status_idx
  on public.canvas_decorator_leads(status);
create index if not exists canvas_decorator_leads_created_at_idx
  on public.canvas_decorator_leads(created_at desc);
create index if not exists canvas_decorator_campaign_runs_started_at_idx
  on public.canvas_decorator_campaign_runs(started_at desc);
create index if not exists canvas_decorator_outreach_events_run_id_idx
  on public.canvas_decorator_outreach_events(run_id);
create index if not exists canvas_decorator_outreach_events_lead_id_idx
  on public.canvas_decorator_outreach_events(lead_id);
create index if not exists canvas_decorator_outreach_events_created_at_idx
  on public.canvas_decorator_outreach_events(created_at desc);
create unique index if not exists canvas_decorator_outreach_events_run_lead_key
  on public.canvas_decorator_outreach_events(run_id, lead_id)
  where run_id is not null and lead_id is not null;
drop trigger if exists canvas_decorator_leads_set_updated_at on public.canvas_decorator_leads;
create trigger canvas_decorator_leads_set_updated_at
before update on public.canvas_decorator_leads
for each row execute function canvas_set_updated_at();
drop trigger if exists canvas_decorator_campaign_runs_set_updated_at on public.canvas_decorator_campaign_runs;
create trigger canvas_decorator_campaign_runs_set_updated_at
before update on public.canvas_decorator_campaign_runs
for each row execute function canvas_set_updated_at();
alter table public.canvas_decorator_leads enable row level security;
alter table public.canvas_decorator_campaign_runs enable row level security;
alter table public.canvas_decorator_outreach_events enable row level security;

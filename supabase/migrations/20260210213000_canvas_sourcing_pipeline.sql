-- Sourcing pipeline tables for external artwork ingestion and outreach.

do $$ begin
  create type canvas_contact_role as enum ('artist', 'gallery');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_lead_status as enum ('new', 'contacted', 'replied', 'joined', 'declined', 'do_not_contact');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_sourced_state as enum ('active', 'requested', 'claimed', 'removed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_sourced_request_status as enum ('open', 'outreach_sent', 'queued_no_contact', 'artist_joined', 'closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_outreach_status as enum ('queued', 'sent', 'failed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_sourcing_run_status as enum ('running', 'succeeded', 'failed');
exception when duplicate_object then null; end $$;
create table if not exists public.canvas_artist_leads (
  id uuid primary key default gen_random_uuid(),
  source_platform text not null default 'artsper',
  artist_name text,
  contact_name text,
  contact_email text,
  contact_role canvas_contact_role,
  profile_url text,
  seller_summary text,
  artist_bio jsonb,
  status canvas_lead_status not null default 'new',
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.canvas_sourced_artworks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.canvas_artist_leads(id) on delete set null,
  source_platform text not null default 'artsper',
  source_artwork_url text not null,
  source_profile_url text,
  title text not null,
  artist_name text,
  image_url text,
  image_urls jsonb,
  description text,
  medium text,
  dimensions text,
  dimensions_raw text,
  width_cm numeric,
  height_cm numeric,
  depth_cm numeric,
  source_price_text text,
  source_price_amount numeric,
  source_price_currency text,
  fx_rate numeric,
  buy_price_usd integer not null default 0,
  rent_price_usd integer not null default 0,
  request_count integer not null default 0,
  artist_contact_email text,
  gallery_contact_email text,
  gallery_name text,
  seller_summary text,
  artist_bio jsonb,
  state canvas_sourced_state not null default 'active',
  claimed_by_user_id uuid references public.canvas_users(id) on delete set null,
  claimed_artwork_id uuid references public.canvas_artworks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvas_sourced_artworks_buy_price_usd_check check (buy_price_usd >= 0),
  constraint canvas_sourced_artworks_rent_price_usd_check check (rent_price_usd >= 0),
  constraint canvas_sourced_artworks_request_count_check check (request_count >= 0)
);
create table if not exists public.canvas_sourced_requests (
  id uuid primary key default gen_random_uuid(),
  sourced_artwork_id uuid not null references public.canvas_sourced_artworks(id) on delete cascade,
  requester_user_id uuid not null references public.canvas_users(id) on delete cascade,
  status canvas_sourced_request_status not null default 'open',
  outreach_target canvas_contact_role,
  outreach_email text,
  outreach_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.canvas_outreach_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.canvas_artist_leads(id) on delete set null,
  sourced_artwork_id uuid references public.canvas_sourced_artworks(id) on delete set null,
  request_id uuid references public.canvas_sourced_requests(id) on delete set null,
  provider text not null default 'mailgun',
  provider_message_id text,
  status canvas_outreach_status not null default 'queued',
  sent_to text,
  error text,
  created_at timestamptz not null default now()
);
create table if not exists public.canvas_fx_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null,
  quote_currency text not null,
  rate numeric not null,
  as_of_date date not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint canvas_fx_rates_rate_positive check (rate > 0)
);
create table if not exists public.canvas_sourcing_runs (
  id uuid primary key default gen_random_uuid(),
  source_platform text not null,
  mode text,
  status canvas_sourcing_run_status not null default 'running',
  fetched integer not null default 0,
  inserted integer not null default 0,
  updated integer not null default 0,
  deduped integer not null default 0,
  invalid integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvas_sourcing_runs_fetched_check check (fetched >= 0),
  constraint canvas_sourcing_runs_inserted_check check (inserted >= 0),
  constraint canvas_sourcing_runs_updated_check check (updated >= 0),
  constraint canvas_sourcing_runs_deduped_check check (deduped >= 0),
  constraint canvas_sourcing_runs_invalid_check check (invalid >= 0)
);
create unique index if not exists canvas_artist_leads_contact_email_key
  on public.canvas_artist_leads(contact_email)
  where contact_email is not null;
create unique index if not exists canvas_artist_leads_profile_platform_key
  on public.canvas_artist_leads(source_platform, profile_url)
  where profile_url is not null;
create unique index if not exists canvas_sourced_artworks_source_artwork_url_key
  on public.canvas_sourced_artworks(source_artwork_url);
create unique index if not exists canvas_fx_rates_base_quote_date_source_key
  on public.canvas_fx_rates(base_currency, quote_currency, as_of_date, source);
create index if not exists canvas_artist_leads_status_idx
  on public.canvas_artist_leads(status);
create index if not exists canvas_artist_leads_source_platform_idx
  on public.canvas_artist_leads(source_platform);
create index if not exists canvas_sourced_artworks_state_idx
  on public.canvas_sourced_artworks(state);
create index if not exists canvas_sourced_artworks_lead_id_idx
  on public.canvas_sourced_artworks(lead_id);
create index if not exists canvas_sourced_artworks_fuzzy_dedupe_idx
  on public.canvas_sourced_artworks(
    lower(coalesce(artist_name, '')),
    lower(coalesce(title, '')),
    coalesce(width_cm, 0),
    coalesce(height_cm, 0)
  );
create index if not exists canvas_sourced_requests_artwork_user_created_idx
  on public.canvas_sourced_requests(sourced_artwork_id, requester_user_id, created_at desc);
create index if not exists canvas_sourced_requests_requester_idx
  on public.canvas_sourced_requests(requester_user_id);
create index if not exists canvas_outreach_events_request_id_idx
  on public.canvas_outreach_events(request_id);
create index if not exists canvas_outreach_events_lead_idx
  on public.canvas_outreach_events(lead_id);
create index if not exists canvas_outreach_events_artwork_idx
  on public.canvas_outreach_events(sourced_artwork_id);
create index if not exists canvas_fx_rates_lookup_idx
  on public.canvas_fx_rates(base_currency, quote_currency, as_of_date desc);
create index if not exists canvas_sourcing_runs_source_platform_idx
  on public.canvas_sourcing_runs(source_platform, started_at desc);
drop trigger if exists canvas_artist_leads_set_updated_at on public.canvas_artist_leads;
create trigger canvas_artist_leads_set_updated_at
before update on public.canvas_artist_leads
for each row execute function canvas_set_updated_at();
drop trigger if exists canvas_sourced_artworks_set_updated_at on public.canvas_sourced_artworks;
create trigger canvas_sourced_artworks_set_updated_at
before update on public.canvas_sourced_artworks
for each row execute function canvas_set_updated_at();
drop trigger if exists canvas_sourced_requests_set_updated_at on public.canvas_sourced_requests;
create trigger canvas_sourced_requests_set_updated_at
before update on public.canvas_sourced_requests
for each row execute function canvas_set_updated_at();
drop trigger if exists canvas_sourcing_runs_set_updated_at on public.canvas_sourcing_runs;
create trigger canvas_sourcing_runs_set_updated_at
before update on public.canvas_sourcing_runs
for each row execute function canvas_set_updated_at();
alter table public.canvas_artist_leads enable row level security;
alter table public.canvas_sourced_artworks enable row level security;
alter table public.canvas_sourced_requests enable row level security;
alter table public.canvas_outreach_events enable row level security;
alter table public.canvas_fx_rates enable row level security;
alter table public.canvas_sourcing_runs enable row level security;

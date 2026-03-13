-- City-level sourcing + demand pipeline metadata.

do $$ begin
  create type canvas_city_pipeline_status as enum ('seeded', 'sourcing', 'ready', 'live', 'paused');
exception when duplicate_object then null; end $$;
alter table public.canvas_artist_leads
  add column if not exists source_city text,
  add column if not exists source_state text,
  add column if not exists source_country text,
  add column if not exists city_slug text;
alter table public.canvas_sourced_artworks
  add column if not exists source_city text,
  add column if not exists source_state text,
  add column if not exists source_country text,
  add column if not exists city_slug text;
alter table public.canvas_decorator_leads
  add column if not exists person_city text,
  add column if not exists city_slug text;
alter table public.canvas_decorator_campaign_runs
  add column if not exists city_slug text;
alter table public.canvas_decorator_outreach_events
  add column if not exists city_slug text;
create table if not exists public.canvas_city_pipeline (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  state text,
  country text not null default 'US',
  city_slug text not null,
  status canvas_city_pipeline_status not null default 'seeded',
  artist_lead_count integer not null default 0,
  active_artwork_count integer not null default 0,
  decorator_lead_count integer not null default 0,
  last_scored_at timestamptz,
  ready_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvas_city_pipeline_artist_lead_count_check check (artist_lead_count >= 0),
  constraint canvas_city_pipeline_active_artwork_count_check check (active_artwork_count >= 0),
  constraint canvas_city_pipeline_decorator_lead_count_check check (decorator_lead_count >= 0)
);
create unique index if not exists canvas_city_pipeline_city_slug_key
  on public.canvas_city_pipeline(city_slug);
create index if not exists canvas_city_pipeline_status_idx
  on public.canvas_city_pipeline(status);
create index if not exists canvas_city_pipeline_last_scored_idx
  on public.canvas_city_pipeline(last_scored_at desc);
create index if not exists canvas_artist_leads_city_slug_idx
  on public.canvas_artist_leads(city_slug);
create index if not exists canvas_sourced_artworks_city_slug_idx
  on public.canvas_sourced_artworks(city_slug);
create index if not exists canvas_decorator_leads_city_slug_idx
  on public.canvas_decorator_leads(city_slug);
create index if not exists canvas_decorator_campaign_runs_city_slug_idx
  on public.canvas_decorator_campaign_runs(city_slug);
create index if not exists canvas_decorator_outreach_events_city_slug_idx
  on public.canvas_decorator_outreach_events(city_slug);
drop trigger if exists canvas_city_pipeline_set_updated_at on public.canvas_city_pipeline;
create trigger canvas_city_pipeline_set_updated_at
before update on public.canvas_city_pipeline
for each row execute function canvas_set_updated_at();
alter table public.canvas_city_pipeline enable row level security;

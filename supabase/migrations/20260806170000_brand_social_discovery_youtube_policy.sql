alter table if exists public.demanddev_brands
  add column if not exists social_discovery_youtube_policy jsonb not null default '{}'::jsonb;

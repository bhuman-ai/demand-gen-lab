alter table if exists public.demanddev_brands
  add column if not exists social_discovery_comment_prompt text not null default '',
  add column if not exists social_discovery_search_strategy jsonb not null default '{}'::jsonb;

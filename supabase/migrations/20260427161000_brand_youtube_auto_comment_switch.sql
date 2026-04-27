alter table if exists public.demanddev_brands
  add column if not exists social_discovery_youtube_auto_comment_enabled boolean not null default false;

update public.demanddev_brands
set social_discovery_youtube_auto_comment_enabled = false
where social_discovery_youtube_auto_comment_enabled is distinct from false;

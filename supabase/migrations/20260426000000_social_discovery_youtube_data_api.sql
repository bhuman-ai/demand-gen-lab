alter table if exists public.demanddev_social_discovery_posts
  drop constraint if exists demanddev_social_discovery_posts_provider_check;

alter table if exists public.demanddev_social_discovery_posts
  add constraint demanddev_social_discovery_posts_provider_check
  check (provider in ('exa', 'dataforseo', 'youtube-websub', 'youtube-data-api'));

alter table if exists public.demanddev_social_discovery_runs
  drop constraint if exists demanddev_social_discovery_runs_provider_check;

alter table if exists public.demanddev_social_discovery_runs
  add constraint demanddev_social_discovery_runs_provider_check
  check (provider in ('exa', 'dataforseo', 'youtube-websub', 'youtube-data-api'));

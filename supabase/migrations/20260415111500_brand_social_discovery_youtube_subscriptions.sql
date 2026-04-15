alter table demanddev_brands
  add column if not exists social_discovery_youtube_subscriptions jsonb not null default '[]'::jsonb;

alter table demanddev_brands
  add column if not exists social_discovery_platforms text[] not null default '{}'::text[];

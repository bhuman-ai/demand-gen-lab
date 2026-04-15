alter table demanddev_brands
  add column if not exists social_discovery_queries text[] not null default '{}'::text[];

alter table if exists demanddev_brands
  add column if not exists product text not null default '';

alter table if exists demanddev_brands
  add column if not exists target_markets jsonb not null default '[]'::jsonb;

alter table if exists demanddev_brands
  add column if not exists ideal_customer_profiles jsonb not null default '[]'::jsonb;

alter table if exists demanddev_brands
  add column if not exists key_features jsonb not null default '[]'::jsonb;

alter table if exists demanddev_brands
  add column if not exists key_benefits jsonb not null default '[]'::jsonb;

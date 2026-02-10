alter table if exists demanddev_brands
add column if not exists objectives jsonb not null default '[]'::jsonb;

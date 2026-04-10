alter table demanddev_brands
  add column if not exists operable_personas text[] not null default '{}'::text[];

alter table demanddev_brands
  add column if not exists available_assets text[] not null default '{}'::text[];

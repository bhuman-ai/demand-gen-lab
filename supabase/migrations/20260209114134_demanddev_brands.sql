create table if not exists demanddev_brands (
  id text primary key,
  brand_name text not null,
  website text not null,
  tone text,
  target_buyers text,
  offers text,
  proof text,
  modules jsonb not null default '{}'::jsonb,
  ideas jsonb not null default '[]'::jsonb,
  sequences jsonb not null default '[]'::jsonb,
  leads jsonb not null default '[]'::jsonb,
  inbox jsonb not null default '[]'::jsonb,
  domains jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demanddev_brands_brand_name_idx on demanddev_brands (brand_name);

create or replace function demanddev_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists demanddev_brands_updated_at on demanddev_brands;
create trigger demanddev_brands_updated_at
before update on demanddev_brands
for each row execute function demanddev_set_updated_at();

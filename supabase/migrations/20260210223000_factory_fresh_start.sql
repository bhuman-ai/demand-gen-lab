drop table if exists demanddev_campaigns;
drop table if exists demanddev_brands;

create table demanddev_brands (
  id text primary key,
  name text not null,
  website text not null,
  tone text not null default '',
  notes text not null default '',
  domains jsonb not null default '[]'::jsonb,
  leads jsonb not null default '[]'::jsonb,
  inbox jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index demanddev_brands_name_idx on demanddev_brands (name);

create table demanddev_campaigns (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  objective jsonb not null default '{}'::jsonb,
  hypotheses jsonb not null default '[]'::jsonb,
  experiments jsonb not null default '[]'::jsonb,
  evolution jsonb not null default '[]'::jsonb,
  step_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index demanddev_campaigns_brand_idx on demanddev_campaigns (brand_id);
create index demanddev_campaigns_updated_at_idx on demanddev_campaigns (updated_at desc);

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

drop trigger if exists demanddev_campaigns_updated_at on demanddev_campaigns;
create trigger demanddev_campaigns_updated_at
before update on demanddev_campaigns
for each row execute function demanddev_set_updated_at();

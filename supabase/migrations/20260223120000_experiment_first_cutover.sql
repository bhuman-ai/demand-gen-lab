create table if not exists demanddev_experiments (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'ready', 'running', 'paused', 'completed', 'promoted', 'archived')),
  offer text not null default '',
  audience text not null default '',
  message_flow jsonb not null default '{}'::jsonb,
  test_envelope jsonb not null default '{}'::jsonb,
  success_metric jsonb not null default '{}'::jsonb,
  last_run_id text not null default '',
  metrics_summary jsonb not null default '{}'::jsonb,
  promoted_campaign_id text not null default '',
  runtime_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demanddev_experiments_brand_idx on demanddev_experiments (brand_id);
create index if not exists demanddev_experiments_status_idx on demanddev_experiments (status);
create index if not exists demanddev_experiments_updated_at_idx on demanddev_experiments (updated_at desc);

create table if not exists demanddev_scale_campaigns (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  source_experiment_id text not null references demanddev_experiments(id) on delete restrict,
  snapshot jsonb not null default '{}'::jsonb,
  scale_policy jsonb not null default '{}'::jsonb,
  last_run_id text not null default '',
  metrics_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demanddev_scale_campaigns_brand_idx on demanddev_scale_campaigns (brand_id);
create index if not exists demanddev_scale_campaigns_source_idx on demanddev_scale_campaigns (source_experiment_id);
create index if not exists demanddev_scale_campaigns_status_idx on demanddev_scale_campaigns (status);
create index if not exists demanddev_scale_campaigns_updated_at_idx on demanddev_scale_campaigns (updated_at desc);

alter table if exists demanddev_outreach_runs
  add column if not exists owner_type text not null default 'experiment';

alter table if exists demanddev_outreach_runs
  add column if not exists owner_id text not null default '';

update demanddev_outreach_runs
set
  owner_type = 'experiment',
  owner_id = case
    when coalesce(experiment_id, '') <> '' then experiment_id
    else campaign_id
  end
where coalesce(owner_id, '') = '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'demanddev_outreach_runs_owner_type_chk'
  ) then
    alter table demanddev_outreach_runs
      add constraint demanddev_outreach_runs_owner_type_chk
      check (owner_type in ('experiment', 'campaign'));
  end if;
end
$$;

create index if not exists demanddev_outreach_runs_owner_idx
  on demanddev_outreach_runs (brand_id, owner_type, owner_id, created_at desc);

drop trigger if exists demanddev_experiments_updated_at on demanddev_experiments;
create trigger demanddev_experiments_updated_at
before update on demanddev_experiments
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_scale_campaigns_updated_at on demanddev_scale_campaigns;
create trigger demanddev_scale_campaigns_updated_at
before update on demanddev_scale_campaigns
for each row execute function demanddev_set_updated_at();

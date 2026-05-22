create table if not exists demanddev_mission_channel_runs (
  id text primary key,
  mission_id text not null references demanddev_missions(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  channel text not null default 'email',
  provider text not null default 'lastb2b',
  provider_campaign_id text not null default '',
  provider_account_id text not null default '',
  provider_user_id text not null default '',
  status text not null default 'draft' check (
    status in ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed', 'blocked')
  ),
  name text not null default '',
  source_run_id text not null default '',
  source_campaign_id text not null default '',
  source_experiment_id text not null default '',
  target_summary text not null default '',
  message text not null default '',
  limits jsonb not null default '{}'::jsonb,
  provider_payload jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(limits) = 'object'),
  check (jsonb_typeof(provider_payload) = 'object')
);

create table if not exists demanddev_mission_channel_touches (
  id text primary key,
  channel_run_id text not null references demanddev_mission_channel_runs(id) on delete cascade,
  mission_id text not null references demanddev_missions(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  lead_id text not null default '',
  channel text not null default 'email',
  provider text not null default 'lastb2b',
  provider_event_id text not null default '',
  provider_profile_url text not null default '',
  provider_person_name text not null default '',
  touch_type text not null default 'status',
  status text not null default 'unknown',
  message text not null default '',
  raw jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(raw) = 'object')
);

create index if not exists demanddev_mission_channel_runs_mission_idx
  on demanddev_mission_channel_runs (mission_id, updated_at desc);

create index if not exists demanddev_mission_channel_runs_brand_idx
  on demanddev_mission_channel_runs (brand_id, updated_at desc);

create index if not exists demanddev_mission_channel_runs_provider_campaign_idx
  on demanddev_mission_channel_runs (provider, provider_campaign_id);

create index if not exists demanddev_mission_channel_touches_run_idx
  on demanddev_mission_channel_touches (channel_run_id, occurred_at desc, created_at desc);

create index if not exists demanddev_mission_channel_touches_brand_idx
  on demanddev_mission_channel_touches (brand_id, created_at desc);

create unique index if not exists demanddev_mission_channel_touches_provider_event_idx
  on demanddev_mission_channel_touches (channel_run_id, provider_event_id, touch_type);

drop trigger if exists demanddev_mission_channel_runs_updated_at on demanddev_mission_channel_runs;
create trigger demanddev_mission_channel_runs_updated_at
before update on demanddev_mission_channel_runs
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_mission_channel_touches_updated_at on demanddev_mission_channel_touches;
create trigger demanddev_mission_channel_touches_updated_at
before update on demanddev_mission_channel_touches
for each row execute function demanddev_set_updated_at();

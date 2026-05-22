create table if not exists demanddev_missions (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  status text not null default 'draft' check (
    status in (
      'draft',
      'site_analyzing',
      'plan_ready',
      'starting',
      'running',
      'monitoring',
      'learning',
      'deliverability_blocked',
      'paused',
      'completed',
      'failed'
    )
  ),
  website_url text not null default '',
  target_customer_text text not null default '',
  generated_plan jsonb not null default '{}'::jsonb,
  approved_plan jsonb not null default '{}'::jsonb,
  approval_policy jsonb not null default '{}'::jsonb,
  deliverability_state jsonb not null default '{}'::jsonb,
  metrics_summary jsonb not null default '{}'::jsonb,
  current_experiment_id text not null default '',
  current_runtime_campaign_id text not null default '',
  current_runtime_experiment_id text not null default '',
  current_run_id text not null default '',
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(generated_plan) = 'object'),
  check (jsonb_typeof(approved_plan) = 'object'),
  check (jsonb_typeof(approval_policy) = 'object'),
  check (jsonb_typeof(deliverability_state) = 'object'),
  check (jsonb_typeof(metrics_summary) = 'object')
);

create table if not exists demanddev_mission_events (
  id text primary key,
  mission_id text not null references demanddev_missions(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  event_type text not null,
  summary text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object')
);

create table if not exists demanddev_mission_agent_decisions (
  id text primary key,
  mission_id text not null references demanddev_missions(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  agent text not null,
  action text not null,
  rationale text not null default '',
  risk_level text not null default 'safe_write' check (risk_level in ('read', 'safe_write', 'guarded_write', 'blocked')),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(input) = 'object'),
  check (jsonb_typeof(output) = 'object')
);

create table if not exists demanddev_mission_learnings (
  id text primary key,
  mission_id text not null references demanddev_missions(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  learning_type text not null,
  summary text not null default '',
  confidence numeric(4, 3) not null default 0.500,
  evidence jsonb not null default '{}'::jsonb,
  recommended_action text not null default '',
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(evidence) = 'object')
);

create index if not exists demanddev_missions_brand_updated_idx
  on demanddev_missions (brand_id, updated_at desc);

create index if not exists demanddev_missions_status_idx
  on demanddev_missions (status, updated_at desc);

create index if not exists demanddev_mission_events_mission_idx
  on demanddev_mission_events (mission_id, created_at desc);

create index if not exists demanddev_mission_agent_decisions_mission_idx
  on demanddev_mission_agent_decisions (mission_id, created_at desc);

create index if not exists demanddev_mission_learnings_mission_idx
  on demanddev_mission_learnings (mission_id, created_at desc);

drop trigger if exists demanddev_missions_updated_at on demanddev_missions;
create trigger demanddev_missions_updated_at
before update on demanddev_missions
for each row execute function demanddev_set_updated_at();

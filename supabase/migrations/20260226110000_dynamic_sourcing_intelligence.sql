create table if not exists demanddev_sourcing_actor_profiles (
  actor_id text primary key,
  stage_hints text[] not null default '{}'::text[],
  schema_summary jsonb not null default '{}'::jsonb,
  compatibility_score numeric not null default 0,
  last_seen_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists demanddev_outreach_runs
  add column if not exists sourcing_trace_summary jsonb not null default '{}'::jsonb;

create table if not exists demanddev_sourcing_chain_decisions (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  experiment_owner_id text not null,
  runtime_campaign_id text not null,
  runtime_experiment_id text not null,
  run_id text references demanddev_outreach_runs(id) on delete cascade,
  strategy text not null default '',
  rationale text not null default '',
  budget_used_usd numeric not null default 0,
  quality_policy jsonb not null default '{}'::jsonb,
  selected_chain jsonb not null default '[]'::jsonb,
  probe_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists demanddev_sourcing_probe_results (
  id text primary key,
  decision_id text not null references demanddev_sourcing_chain_decisions(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  experiment_owner_id text not null,
  run_id text references demanddev_outreach_runs(id) on delete cascade,
  step_index integer not null,
  actor_id text not null,
  stage text not null,
  probe_input_hash text not null default '',
  outcome text not null check (outcome in ('pass', 'fail')),
  quality_metrics jsonb not null default '{}'::jsonb,
  cost_estimate_usd numeric not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists demanddev_sourcing_actor_memory (
  actor_id text primary key,
  success_count integer not null default 0,
  fail_count integer not null default 0,
  compatibility_fail_count integer not null default 0,
  leads_accepted integer not null default 0,
  leads_rejected integer not null default 0,
  avg_quality numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demanddev_sourcing_chain_decisions_brand_experiment_idx
  on demanddev_sourcing_chain_decisions (brand_id, experiment_owner_id, created_at desc);

create index if not exists demanddev_sourcing_chain_decisions_run_idx
  on demanddev_sourcing_chain_decisions (run_id, created_at desc);

create index if not exists demanddev_sourcing_probe_results_decision_idx
  on demanddev_sourcing_probe_results (decision_id, created_at desc);

create index if not exists demanddev_sourcing_probe_results_run_idx
  on demanddev_sourcing_probe_results (run_id, created_at desc);

drop trigger if exists demanddev_sourcing_actor_profiles_updated_at on demanddev_sourcing_actor_profiles;
create trigger demanddev_sourcing_actor_profiles_updated_at
before update on demanddev_sourcing_actor_profiles
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_sourcing_chain_decisions_updated_at on demanddev_sourcing_chain_decisions;
create trigger demanddev_sourcing_chain_decisions_updated_at
before update on demanddev_sourcing_chain_decisions
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_sourcing_actor_memory_updated_at on demanddev_sourcing_actor_memory;
create trigger demanddev_sourcing_actor_memory_updated_at
before update on demanddev_sourcing_actor_memory
for each row execute function demanddev_set_updated_at();

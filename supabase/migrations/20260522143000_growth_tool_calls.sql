create table if not exists demanddev_growth_tool_calls (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  mission_id text references demanddev_missions(id) on delete cascade,
  tool_name text not null,
  provider text not null default '',
  category text not null default '',
  capability text not null default '',
  risk_level text not null default 'read' check (risk_level in ('read', 'safe_write', 'guarded_write', 'blocked')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'blocked', 'dry_run')),
  agent text not null default '',
  rationale text not null default '',
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text not null default '',
  dry_run boolean not null default false,
  spend_risk boolean not null default false,
  reputation_risk boolean not null default false,
  estimated_cost_usd numeric(12, 4) not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (jsonb_typeof(input) = 'object'),
  check (jsonb_typeof(output) = 'object')
);

create index if not exists demanddev_growth_tool_calls_mission_idx
  on demanddev_growth_tool_calls (mission_id, created_at desc);

create index if not exists demanddev_growth_tool_calls_brand_idx
  on demanddev_growth_tool_calls (brand_id, created_at desc);

create index if not exists demanddev_growth_tool_calls_tool_idx
  on demanddev_growth_tool_calls (tool_name, created_at desc);

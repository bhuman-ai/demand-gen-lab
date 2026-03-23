create table if not exists demanddev_operator_threads (
  id text primary key,
  user_id uuid references public.users(id) on delete cascade,
  brand_id text,
  title text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  last_summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists demanddev_operator_messages (
  id text primary key,
  thread_id text not null references demanddev_operator_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  kind text not null check (kind in ('message', 'tool_call', 'tool_result', 'approval_request', 'receipt', 'system_note')),
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(content) = 'object')
);

create table if not exists demanddev_operator_runs (
  id text primary key,
  thread_id text not null references demanddev_operator_threads(id) on delete cascade,
  brand_id text,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'canceled')),
  model text not null default '',
  context_snapshot jsonb not null default '{}'::jsonb,
  plan jsonb not null default '[]'::jsonb,
  error_text text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (jsonb_typeof(context_snapshot) = 'object'),
  check (jsonb_typeof(plan) = 'array')
);

create table if not exists demanddev_operator_actions (
  id text primary key,
  run_id text not null references demanddev_operator_runs(id) on delete cascade,
  tool_name text not null,
  risk_level text not null check (risk_level in ('read', 'safe_write', 'guarded_write', 'blocked')),
  approval_mode text not null check (approval_mode in ('none', 'confirm', 'blocked')),
  status text not null check (status in ('proposed', 'awaiting_approval', 'running', 'completed', 'failed', 'canceled', 'blocked')),
  input jsonb not null default '{}'::jsonb,
  preview jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  undo_payload jsonb not null default '{}'::jsonb,
  error_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(input) = 'object'),
  check (jsonb_typeof(preview) = 'object'),
  check (jsonb_typeof(result) = 'object'),
  check (jsonb_typeof(undo_payload) = 'object')
);

create table if not exists demanddev_operator_approvals (
  id text primary key,
  action_id text not null references demanddev_operator_actions(id) on delete cascade,
  requested_by_user_id uuid references public.users(id) on delete set null,
  decided_by_user_id uuid references public.users(id) on delete set null,
  decision text not null check (decision in ('approved', 'rejected')),
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists demanddev_operator_memory (
  id text primary key,
  scope_type text not null check (scope_type in ('account', 'brand', 'thread')),
  scope_id text not null,
  memory_key text not null,
  value jsonb not null default '{}'::jsonb,
  source text not null default 'operator',
  confidence numeric(4, 3) not null default 1.0,
  sensitivity text not null default 'normal' check (sensitivity in ('normal', 'sensitive')),
  last_verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_type, scope_id, memory_key),
  check (jsonb_typeof(value) = 'object')
);

create index if not exists demanddev_operator_threads_user_idx
  on demanddev_operator_threads(user_id, updated_at desc);

create index if not exists demanddev_operator_threads_brand_idx
  on demanddev_operator_threads(brand_id, updated_at desc);

create index if not exists demanddev_operator_messages_thread_idx
  on demanddev_operator_messages(thread_id, created_at asc);

create index if not exists demanddev_operator_runs_thread_idx
  on demanddev_operator_runs(thread_id, started_at desc);

create index if not exists demanddev_operator_actions_run_idx
  on demanddev_operator_actions(run_id, created_at asc);

create index if not exists demanddev_operator_actions_status_idx
  on demanddev_operator_actions(status, created_at desc);

create index if not exists demanddev_operator_memory_scope_idx
  on demanddev_operator_memory(scope_type, scope_id, updated_at desc);

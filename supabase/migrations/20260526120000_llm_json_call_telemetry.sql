create table if not exists demanddev_llm_json_calls (
  id text primary key,
  task text not null default '',
  provider text not null default '' check (provider in ('openai', 'openrouter', '')),
  model text not null default '',
  status text not null default 'completed' check (status in ('completed', 'failed')),
  format_type text not null default '',
  prompt_chars integer not null default 0 check (prompt_chars >= 0),
  completion_chars integer not null default 0 check (completion_chars >= 0),
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  token_source text not null default 'estimate' check (token_source in ('api', 'estimate')),
  max_output_tokens integer not null default 0 check (max_output_tokens >= 0),
  reasoning_effort text not null default '',
  duration_ms integer not null default 0 check (duration_ms >= 0),
  error text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists demanddev_llm_json_calls_created_idx
  on demanddev_llm_json_calls (created_at desc);

create index if not exists demanddev_llm_json_calls_task_idx
  on demanddev_llm_json_calls (task, created_at desc);

create index if not exists demanddev_llm_json_calls_provider_model_idx
  on demanddev_llm_json_calls (provider, model, created_at desc);

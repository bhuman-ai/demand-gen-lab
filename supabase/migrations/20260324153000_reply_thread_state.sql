create table if not exists demanddev_reply_thread_state (
  thread_id text primary key references demanddev_reply_threads(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  state_revision integer not null default 1,
  canonical_state jsonb not null default '{}'::jsonb,
  latest_decision jsonb not null default '{}'::jsonb,
  latest_draft_meta jsonb not null default '{}'::jsonb,
  sources_used jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint demanddev_reply_thread_state_canonical_state_object_chk
    check (jsonb_typeof(canonical_state) = 'object'),
  constraint demanddev_reply_thread_state_latest_decision_object_chk
    check (jsonb_typeof(latest_decision) = 'object'),
  constraint demanddev_reply_thread_state_latest_draft_meta_object_chk
    check (jsonb_typeof(latest_draft_meta) = 'object'),
  constraint demanddev_reply_thread_state_sources_used_array_chk
    check (jsonb_typeof(sources_used) = 'array')
);

create index if not exists demanddev_reply_thread_state_brand_updated_idx
  on demanddev_reply_thread_state (brand_id, updated_at desc);

create index if not exists demanddev_reply_thread_state_run_updated_idx
  on demanddev_reply_thread_state (run_id, updated_at desc);

drop trigger if exists demanddev_reply_thread_state_updated_at on demanddev_reply_thread_state;
create trigger demanddev_reply_thread_state_updated_at
before update on demanddev_reply_thread_state
for each row execute function demanddev_set_updated_at();

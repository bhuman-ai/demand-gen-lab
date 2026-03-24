alter table if exists demanddev_reply_threads
  drop constraint if exists demanddev_reply_threads_source_type_chk;

alter table if exists demanddev_reply_threads
  add constraint demanddev_reply_threads_source_type_chk
  check (source_type in ('outreach', 'mailbox', 'eval'));

create table if not exists demanddev_inbox_eval_runs (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  scenario_id text not null,
  scenario_name text not null default '',
  status text not null default 'running',
  seed text not null default '',
  thread_id text null references demanddev_reply_threads(id) on delete set null,
  scenario jsonb not null default '{}'::jsonb,
  transcript jsonb not null default '[]'::jsonb,
  scorecard jsonb null,
  last_error text not null default '',
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint demanddev_inbox_eval_runs_status_chk
    check (status in ('running', 'completed', 'failed')),
  constraint demanddev_inbox_eval_runs_scenario_object_chk
    check (jsonb_typeof(scenario) = 'object'),
  constraint demanddev_inbox_eval_runs_transcript_array_chk
    check (jsonb_typeof(transcript) = 'array'),
  constraint demanddev_inbox_eval_runs_scorecard_object_chk
    check (scorecard is null or jsonb_typeof(scorecard) = 'object')
);

create index if not exists demanddev_inbox_eval_runs_brand_created_idx
  on demanddev_inbox_eval_runs (brand_id, created_at desc);

create index if not exists demanddev_inbox_eval_runs_thread_idx
  on demanddev_inbox_eval_runs (thread_id);

drop trigger if exists demanddev_inbox_eval_runs_updated_at on demanddev_inbox_eval_runs;
create trigger demanddev_inbox_eval_runs_updated_at
before update on demanddev_inbox_eval_runs
for each row execute function demanddev_set_updated_at();

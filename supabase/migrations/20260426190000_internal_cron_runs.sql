create table if not exists demanddev_internal_cron_runs (
  id text primary key,
  task_name text not null,
  route text not null default '',
  ok boolean not null default false,
  duration_ms integer not null default 0,
  details jsonb,
  error text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists demanddev_internal_cron_runs_task_created_idx
  on demanddev_internal_cron_runs (task_name, created_at desc);

create index if not exists demanddev_internal_cron_runs_created_idx
  on demanddev_internal_cron_runs (created_at desc);

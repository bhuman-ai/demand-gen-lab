create table if not exists demanddev_sender_launch_actions (
  id text primary key,
  sender_launch_id text not null,
  sender_account_id text not null,
  brand_id text not null,
  lane text not null default 'opt_in',
  action_type text not null default 'execute_opt_in',
  source_key text not null default '',
  status text not null default 'queued',
  execute_after timestamptz not null default timezone('utc', now()),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  payload jsonb not null default '{}'::jsonb,
  result_summary text not null default '',
  last_error text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists demanddev_sender_launch_actions_launch_idx
  on demanddev_sender_launch_actions (sender_launch_id, updated_at desc);

create index if not exists demanddev_sender_launch_actions_sender_idx
  on demanddev_sender_launch_actions (sender_account_id, updated_at desc);

create index if not exists demanddev_sender_launch_actions_brand_idx
  on demanddev_sender_launch_actions (brand_id, updated_at desc);

create index if not exists demanddev_sender_launch_actions_due_idx
  on demanddev_sender_launch_actions (status, execute_after asc);

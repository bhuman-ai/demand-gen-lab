create table if not exists demanddev_sender_launches (
  id text primary key,
  sender_account_id text not null,
  brand_id text not null,
  from_email text not null default '',
  domain text not null default '',
  plan_type text not null default 'fresh',
  state text not null default 'setup',
  readiness_score integer not null default 0,
  summary text not null default '',
  next_step text not null default '',
  topic_summary text not null default '',
  topic_keywords text[] not null default '{}',
  source_experiment_ids text[] not null default '{}',
  infra_score integer not null default 0,
  reputation_score integer not null default 0,
  trust_score integer not null default 0,
  safety_score integer not null default 0,
  topic_score integer not null default 0,
  daily_cap integer not null default 0,
  sent_count integer not null default 0,
  replied_count integer not null default 0,
  bounced_count integer not null default 0,
  failed_count integer not null default 0,
  inbox_rate double precision not null default 0,
  spam_rate double precision not null default 0,
  trust_event_count integer not null default 0,
  paused_until timestamptz,
  pause_reason text not null default '',
  last_event_at timestamptz,
  last_evaluated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists demanddev_sender_launches_brand_sender_idx
  on demanddev_sender_launches (brand_id, sender_account_id);

create index if not exists demanddev_sender_launches_sender_idx
  on demanddev_sender_launches (sender_account_id);

create table if not exists demanddev_sender_launch_events (
  id text primary key,
  sender_launch_id text not null,
  sender_account_id text not null,
  brand_id text not null,
  event_type text not null,
  title text not null default '',
  detail text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists demanddev_sender_launch_events_launch_idx
  on demanddev_sender_launch_events (sender_launch_id, occurred_at desc);

create index if not exists demanddev_sender_launch_events_sender_idx
  on demanddev_sender_launch_events (sender_account_id, occurred_at desc);

create index if not exists demanddev_sender_launch_events_brand_idx
  on demanddev_sender_launch_events (brand_id, occurred_at desc);

create table if not exists demanddev_deliverability_probe_runs (
  id text primary key,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  brand_id text not null,
  campaign_id text not null,
  experiment_id text not null,
  probe_token text not null,
  probe_variant text not null default 'production',
  status text not null default 'queued',
  stage text not null default 'send',
  source_message_id text not null default '',
  source_message_status text not null default '',
  source_type text not null default '',
  source_node_id text not null default '',
  source_lead_id text not null default '',
  sender_account_id text references demanddev_outreach_accounts(id) on delete set null,
  sender_account_name text not null default '',
  from_email text not null default '',
  reply_to_email text not null default '',
  subject text not null default '',
  content_hash text not null default '',
  reservation_ids jsonb not null default '[]'::jsonb,
  monitor_targets jsonb not null default '[]'::jsonb,
  results jsonb not null default '[]'::jsonb,
  poll_attempt integer not null default 0,
  placement text not null default 'unknown',
  total_monitors integer not null default 0,
  counts jsonb not null default '{}'::jsonb,
  summary_text text not null default '',
  last_error text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists demanddev_deliverability_probe_runs_token_idx
  on demanddev_deliverability_probe_runs (run_id, probe_token, probe_variant);

create index if not exists demanddev_deliverability_probe_runs_sender_idx
  on demanddev_deliverability_probe_runs (brand_id, sender_account_id, from_email, created_at desc);

create table if not exists demanddev_deliverability_seed_reservations (
  id text primary key,
  probe_run_id text not null references demanddev_deliverability_probe_runs(id) on delete cascade,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  brand_id text not null,
  sender_account_id text not null references demanddev_outreach_accounts(id) on delete cascade,
  from_email text not null,
  monitor_account_id text not null references demanddev_outreach_accounts(id) on delete cascade,
  monitor_email text not null,
  probe_variant text not null default 'production',
  content_hash text not null default '',
  probe_token text not null default '',
  status text not null default 'reserved',
  provider_message_id text not null default '',
  released_reason text not null default '',
  reserved_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demanddev_deliverability_seed_reservations_sender_idx
  on demanddev_deliverability_seed_reservations (brand_id, sender_account_id, from_email, created_at desc);

create index if not exists demanddev_deliverability_seed_reservations_probe_idx
  on demanddev_deliverability_seed_reservations (probe_run_id, created_at asc);

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists demanddev_deliverability_probe_runs_updated_at on demanddev_deliverability_probe_runs;
create trigger demanddev_deliverability_probe_runs_updated_at
before update on demanddev_deliverability_probe_runs
for each row execute function public.set_current_timestamp_updated_at();

drop trigger if exists demanddev_deliverability_seed_reservations_updated_at on demanddev_deliverability_seed_reservations;
create trigger demanddev_deliverability_seed_reservations_updated_at
before update on demanddev_deliverability_seed_reservations
for each row execute function public.set_current_timestamp_updated_at();

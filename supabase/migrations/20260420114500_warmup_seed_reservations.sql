create table if not exists demanddev_warmup_seed_reservations (
  id text primary key,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  brand_id text not null,
  sender_account_id text not null references demanddev_outreach_accounts(id) on delete cascade,
  from_email text not null,
  monitor_account_id text not null references demanddev_outreach_accounts(id) on delete cascade,
  monitor_email text not null,
  status text not null default 'reserved',
  provider_message_id text not null default '',
  released_reason text not null default '',
  reserved_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists demanddev_warmup_seed_reservations_run_monitor_idx
  on demanddev_warmup_seed_reservations (run_id, monitor_account_id);
create unique index if not exists demanddev_warmup_seed_reservations_active_monitor_idx
  on demanddev_warmup_seed_reservations (monitor_account_id)
  where status = 'reserved';
create index if not exists demanddev_warmup_seed_reservations_sender_idx
  on demanddev_warmup_seed_reservations (brand_id, sender_account_id, from_email, created_at desc);
create index if not exists demanddev_warmup_seed_reservations_run_idx
  on demanddev_warmup_seed_reservations (run_id, created_at asc);
drop trigger if exists demanddev_warmup_seed_reservations_updated_at on demanddev_warmup_seed_reservations;
create trigger demanddev_warmup_seed_reservations_updated_at
before update on demanddev_warmup_seed_reservations
for each row execute function public.set_current_timestamp_updated_at();

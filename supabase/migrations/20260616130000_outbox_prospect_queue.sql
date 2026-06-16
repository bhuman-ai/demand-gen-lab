create table if not exists demanddev_outbox_prospect_queue (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  email text not null,
  email_normalized text not null,
  name text not null default '',
  company text not null default '',
  title text not null default '',
  domain text not null default '',
  domain_normalized text not null default '',
  source_url text not null default '',
  status text not null default 'eligible' check (
    status in ('eligible', 'reserved', 'held', 'sent', 'failed', 'rejected', 'suppressed', 'expired')
  ),
  source_provider text not null default 'airscale',
  source_mode text not null default 'auto',
  source_query text not null default '',
  offer text not null default '',
  real_verified_email boolean not null default false,
  email_verification jsonb not null default '{}'::jsonb,
  finder_meta jsonb not null default '{}'::jsonb,
  reservation_id text not null default '',
  reserved_run_id text not null default '',
  reserved_message_id text not null default '',
  reserved_at timestamptz,
  sent_at timestamptz,
  rejected_reason text not null default '',
  last_error text not null default '',
  attempts integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists demanddev_outbox_prospect_queue_brand_email_idx
  on demanddev_outbox_prospect_queue (brand_id, email_normalized);

create index if not exists demanddev_outbox_prospect_queue_ready_idx
  on demanddev_outbox_prospect_queue (brand_id, status, created_at)
  where status in ('eligible', 'reserved', 'held');

create index if not exists demanddev_outbox_prospect_queue_domain_idx
  on demanddev_outbox_prospect_queue (brand_id, domain_normalized);

drop trigger if exists demanddev_outbox_prospect_queue_updated_at on demanddev_outbox_prospect_queue;
create trigger demanddev_outbox_prospect_queue_updated_at
before update on demanddev_outbox_prospect_queue
for each row execute function demanddev_set_updated_at();

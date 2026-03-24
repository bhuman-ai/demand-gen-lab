create table if not exists demanddev_reply_thread_feedback (
  id text primary key,
  thread_id text not null references demanddev_reply_threads(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  type text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint demanddev_reply_thread_feedback_type_chk
    check (type in ('good', 'wrong_move', 'wrong_facts', 'too_aggressive', 'should_be_human'))
);

create index if not exists demanddev_reply_thread_feedback_thread_created_idx
  on demanddev_reply_thread_feedback (thread_id, created_at desc);

create index if not exists demanddev_reply_thread_feedback_brand_created_idx
  on demanddev_reply_thread_feedback (brand_id, created_at desc);

create table if not exists demanddev_inbox_sync_state (
  brand_id text not null references demanddev_brands(id) on delete cascade,
  mailbox_account_id text not null references demanddev_outreach_accounts(id) on delete cascade,
  mailbox_name text not null default '',
  last_inbox_uid bigint not null default 0,
  last_synced_at timestamptz null,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (brand_id, mailbox_account_id),
  constraint demanddev_inbox_sync_state_last_inbox_uid_chk
    check (last_inbox_uid >= 0)
);

create index if not exists demanddev_inbox_sync_state_brand_updated_idx
  on demanddev_inbox_sync_state (brand_id, updated_at desc);

drop trigger if exists demanddev_inbox_sync_state_updated_at on demanddev_inbox_sync_state;
create trigger demanddev_inbox_sync_state_updated_at
before update on demanddev_inbox_sync_state
for each row execute function demanddev_set_updated_at();

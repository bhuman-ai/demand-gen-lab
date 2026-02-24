alter table if exists demanddev_outreach_messages
  add column if not exists generation_meta jsonb not null default '{}'::jsonb;

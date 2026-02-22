create table if not exists demanddev_conversation_maps (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  campaign_id text not null references demanddev_campaigns(id) on delete cascade,
  experiment_id text not null,
  name text not null default 'Variant Conversation Flow',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  draft_graph jsonb not null default '{}'::jsonb,
  published_graph jsonb not null default '{}'::jsonb,
  published_revision integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists demanddev_conversation_maps_variant_idx
  on demanddev_conversation_maps (brand_id, campaign_id, experiment_id);

create table if not exists demanddev_conversation_sessions (
  id text primary key,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  campaign_id text not null references demanddev_campaigns(id) on delete cascade,
  lead_id text not null references demanddev_outreach_run_leads(id) on delete cascade,
  map_id text not null references demanddev_conversation_maps(id) on delete cascade,
  map_revision integer not null default 1,
  state text not null default 'active' check (state in ('active', 'waiting_manual', 'completed', 'failed')),
  current_node_id text not null,
  turn_count integer not null default 0,
  last_intent text not null default '',
  last_confidence numeric not null default 0,
  last_node_entered_at timestamptz not null default now(),
  ended_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists demanddev_conversation_sessions_run_lead_idx
  on demanddev_conversation_sessions (run_id, lead_id);

create table if not exists demanddev_conversation_events (
  id text primary key,
  session_id text not null references demanddev_conversation_sessions(id) on delete cascade,
  run_id text not null references demanddev_outreach_runs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists demanddev_conversation_events_run_idx
  on demanddev_conversation_events (run_id, created_at desc);

alter table if exists demanddev_outreach_messages
  add column if not exists source_type text not null default 'cadence';

alter table if exists demanddev_outreach_messages
  add column if not exists session_id text references demanddev_conversation_sessions(id) on delete set null;

alter table if exists demanddev_outreach_messages
  add column if not exists node_id text not null default '';

alter table if exists demanddev_outreach_messages
  add column if not exists parent_message_id text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'demanddev_outreach_messages_source_type_chk'
  ) then
    alter table demanddev_outreach_messages
      add constraint demanddev_outreach_messages_source_type_chk
      check (source_type in ('cadence', 'conversation'));
  end if;
end
$$;

drop trigger if exists demanddev_conversation_maps_updated_at on demanddev_conversation_maps;
create trigger demanddev_conversation_maps_updated_at
before update on demanddev_conversation_maps
for each row execute function demanddev_set_updated_at();

drop trigger if exists demanddev_conversation_sessions_updated_at on demanddev_conversation_sessions;
create trigger demanddev_conversation_sessions_updated_at
before update on demanddev_conversation_sessions
for each row execute function demanddev_set_updated_at();

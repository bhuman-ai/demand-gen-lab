-- Shipping v2 (quotes, purchases, pickups, tracking webhooks)

alter table canvas_shipments
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists declared_value_usd numeric,
  add column if not exists insurance_amount_usd numeric,
  add column if not exists insured_at timestamptz,
  add column if not exists rates jsonb,
  add column if not exists selected_rate_id text,
  add column if not exists selected_rate jsonb,
  add column if not exists customs jsonb,
  add column if not exists tracking_status text,
  add column if not exists tracking_details jsonb,
  add column if not exists public_tracking_url text,
  add column if not exists last_event_at timestamptz,
  add column if not exists easypost_tracker_id text,
  add column if not exists pickup_id uuid;
do $$ begin
  create trigger canvas_shipments_set_updated_at
  before update on canvas_shipments
  for each row execute function canvas_set_updated_at();
exception when duplicate_object then null; end $$;
create table if not exists canvas_pickups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references canvas_users(id) on delete set null,
  shipment_db_id uuid not null references canvas_shipments(id) on delete cascade,
  status text not null default 'created',
  easypost_pickup_id text not null,
  pickup_date date not null,
  min_time time,
  max_time time,
  instructions text,
  rates jsonb,
  selected_pickup_rate_id text,
  confirmation jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$ begin
  alter table canvas_shipments
    add constraint canvas_shipments_pickup_id_fkey
    foreign key (pickup_id) references canvas_pickups(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger canvas_pickups_set_updated_at
  before update on canvas_pickups
  for each row execute function canvas_set_updated_at();
exception when duplicate_object then null; end $$;
create index if not exists canvas_pickups_user_id_idx on canvas_pickups(user_id);
create index if not exists canvas_pickups_shipment_db_id_idx on canvas_pickups(shipment_db_id);
create index if not exists canvas_pickups_easypost_pickup_id_idx on canvas_pickups(easypost_pickup_id);
create table if not exists canvas_shipping_events (
  id text primary key,
  event_type text,
  payload jsonb,
  received_at timestamptz not null default now()
);
create index if not exists canvas_shipping_events_received_at_idx on canvas_shipping_events(received_at);
alter table canvas_pickups enable row level security;
alter table canvas_shipping_events enable row level security;

-- EasyPost shipping persistence (server-managed; app reads via API)

do $$ begin
  create type canvas_shipment_direction as enum ('outbound', 'return');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_shipment_status as enum ('created', 'purchased', 'cancelled', 'error');
exception when duplicate_object then null; end $$;
create table if not exists canvas_shipments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references canvas_users(id) on delete set null,
  direction canvas_shipment_direction not null default 'outbound',
  status canvas_shipment_status not null default 'created',
  easypost_shipment_id text not null,
  tracking_code text,
  label_url text,
  carrier text,
  service text,
  rate text,
  from_address jsonb,
  to_address jsonb,
  parcel jsonb,
  created_at timestamptz not null default now()
);
create index if not exists canvas_shipments_user_id_idx on canvas_shipments(user_id);
create index if not exists canvas_shipments_easypost_shipment_id_idx on canvas_shipments(easypost_shipment_id);
create index if not exists canvas_shipments_tracking_code_idx on canvas_shipments(tracking_code);
alter table canvas_shipments enable row level security;

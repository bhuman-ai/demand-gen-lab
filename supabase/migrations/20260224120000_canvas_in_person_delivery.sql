-- In-person delivery mutual agreement flow (outbound + return)

-- Delivery enums

do $$ begin
  create type canvas_delivery_method as enum ('shipping', 'in_person');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_delivery_leg_state as enum (
    'shipping',
    'awaiting_proposal',
    'awaiting_response',
    'agreed',
    'paused',
    'completed'
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_party_decision as enum ('pending', 'accepted', 'declined');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_shipping_addon_status as enum ('created', 'completed', 'expired', 'cancelled', 'error');
exception when duplicate_object then null; end $$;
-- Artworks: allow artists to enable in-person handoff.
alter table public.canvas_artworks
  add column if not exists in_person_delivery_enabled boolean not null default false;
-- Checkout sessions: persist outbound delivery selection + optional handoff fields.
alter table public.canvas_checkout_sessions
  add column if not exists outbound_delivery_method canvas_delivery_method not null default 'shipping',
  add column if not exists shipping_fee_cents integer not null default 2000,
  add column if not exists outbound_handoff_date date,
  add column if not exists outbound_handoff_start_time time,
  add column if not exists outbound_handoff_end_time time,
  add column if not exists outbound_handoff_location_note text;
alter table public.canvas_checkout_sessions
  drop constraint if exists canvas_checkout_sessions_shipping_fee_cents_check;
alter table public.canvas_checkout_sessions
  add constraint canvas_checkout_sessions_shipping_fee_cents_check
  check (shipping_fee_cents >= 0);
-- Delivery legs per rental and direction.
create table if not exists public.canvas_rental_delivery_legs (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.canvas_rentals(id) on delete cascade,
  direction canvas_shipment_direction not null,
  method canvas_delivery_method not null default 'shipping',
  state canvas_delivery_leg_state not null default 'shipping',
  initiator_user_id uuid references public.canvas_users(id) on delete set null,
  artist_decision canvas_party_decision not null default 'pending',
  renter_decision canvas_party_decision not null default 'pending',
  proposed_date date,
  proposed_start_time time,
  proposed_end_time time,
  location_note text,
  artist_confirmed_at timestamptz,
  renter_confirmed_at timestamptz,
  paused_reason text,
  requires_shipping_addon boolean not null default false,
  shipping_addon_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rental_id, direction)
);
create index if not exists canvas_rental_delivery_legs_rental_id_idx
  on public.canvas_rental_delivery_legs(rental_id);
create index if not exists canvas_rental_delivery_legs_direction_idx
  on public.canvas_rental_delivery_legs(direction);
create index if not exists canvas_rental_delivery_legs_state_idx
  on public.canvas_rental_delivery_legs(state);
create index if not exists canvas_rental_delivery_legs_method_idx
  on public.canvas_rental_delivery_legs(method);
-- Shipping add-on checkout sessions for outbound fallback.
create table if not exists public.canvas_shipping_addon_sessions (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.canvas_rentals(id) on delete cascade,
  renter_id uuid not null references public.canvas_users(id) on delete cascade,
  status canvas_shipping_addon_status not null default 'created',
  amount_total integer not null,
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.canvas_shipping_addon_sessions
  drop constraint if exists canvas_shipping_addon_sessions_amount_total_check;
alter table public.canvas_shipping_addon_sessions
  add constraint canvas_shipping_addon_sessions_amount_total_check
  check (amount_total >= 0);
create index if not exists canvas_shipping_addon_sessions_rental_id_idx
  on public.canvas_shipping_addon_sessions(rental_id);
create index if not exists canvas_shipping_addon_sessions_status_idx
  on public.canvas_shipping_addon_sessions(status);
create index if not exists canvas_shipping_addon_sessions_stripe_session_id_idx
  on public.canvas_shipping_addon_sessions(stripe_session_id);
-- Keep updated_at current.
do $$ begin
  create trigger canvas_rental_delivery_legs_set_updated_at
  before update on public.canvas_rental_delivery_legs
  for each row execute function public.canvas_set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger canvas_shipping_addon_sessions_set_updated_at
  before update on public.canvas_shipping_addon_sessions
  for each row execute function public.canvas_set_updated_at();
exception when duplicate_object then null; end $$;
alter table public.canvas_rental_delivery_legs enable row level security;
alter table public.canvas_shipping_addon_sessions enable row level security;
-- Backfill active rentals with default shipping legs for both directions.
insert into public.canvas_rental_delivery_legs (
  rental_id,
  direction,
  method,
  state,
  artist_decision,
  renter_decision
)
select
  r.id,
  d.direction::canvas_shipment_direction,
  'shipping'::canvas_delivery_method,
  'shipping'::canvas_delivery_leg_state,
  'accepted'::canvas_party_decision,
  'accepted'::canvas_party_decision
from public.canvas_rentals r
cross join (
  values ('outbound'), ('return')
) as d(direction)
where r.status in ('active', 'scheduled_return')
  and not exists (
    select 1
    from public.canvas_rental_delivery_legs l
    where l.rental_id = r.id
      and l.direction = d.direction::canvas_shipment_direction
  );

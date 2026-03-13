-- Stripe Checkout session persistence + webhook dedupe.
-- Server-managed (service role); the mobile/web app reads via API.

do $$ begin
  create type canvas_checkout_status as enum ('created', 'completed', 'expired', 'cancelled', 'error');
exception when duplicate_object then null; end $$;
create table if not exists canvas_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  renter_id uuid not null references canvas_users(id) on delete cascade,
  artwork_id uuid not null references canvas_artworks(id) on delete cascade,
  status canvas_checkout_status not null default 'created',
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  amount_total integer,
  currency text,
  expires_at timestamptz,
  completed_at timestamptz,
  rental_id uuid references canvas_rentals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$ begin
  create trigger canvas_checkout_sessions_set_updated_at
  before update on canvas_checkout_sessions
  for each row execute function canvas_set_updated_at();
exception when duplicate_object then null; end $$;
create index if not exists canvas_checkout_sessions_renter_id_idx on canvas_checkout_sessions(renter_id);
create index if not exists canvas_checkout_sessions_artwork_id_idx on canvas_checkout_sessions(artwork_id);
create index if not exists canvas_checkout_sessions_created_at_idx on canvas_checkout_sessions(created_at);
create table if not exists canvas_payment_events (
  id text primary key,
  event_type text,
  payload jsonb,
  received_at timestamptz not null default now()
);
create index if not exists canvas_payment_events_received_at_idx on canvas_payment_events(received_at);
alter table canvas_checkout_sessions enable row level security;
alter table canvas_payment_events enable row level security;

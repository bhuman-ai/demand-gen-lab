-- EasyPost wallet top-up audit + idempotency ledger.
-- Server-managed writes from API routes (service role).

create table if not exists public.canvas_easypost_wallet_topups (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source text not null,
  status text not null default 'created',
  rental_id uuid references public.canvas_rentals(id) on delete set null,
  shipment_id uuid references public.canvas_shipments(id) on delete set null,
  checkout_session_id uuid references public.canvas_checkout_sessions(id) on delete set null,
  stripe_session_id text,
  required_amount_cents integer not null default 0,
  balance_before_cents integer,
  balance_after_cents integer,
  topup_amount_cents integer not null default 0,
  payment_method_id text,
  error_code text,
  error_message text,
  details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvas_easypost_wallet_topups_required_amount_cents_check check (required_amount_cents >= 0),
  constraint canvas_easypost_wallet_topups_topup_amount_cents_check check (topup_amount_cents >= 0)
);
do $$ begin
  create trigger canvas_easypost_wallet_topups_set_updated_at
  before update on public.canvas_easypost_wallet_topups
  for each row execute function public.canvas_set_updated_at();
exception when duplicate_object then null; end $$;
create index if not exists canvas_easypost_wallet_topups_rental_id_idx
  on public.canvas_easypost_wallet_topups(rental_id);
create index if not exists canvas_easypost_wallet_topups_shipment_id_idx
  on public.canvas_easypost_wallet_topups(shipment_id);
create index if not exists canvas_easypost_wallet_topups_status_idx
  on public.canvas_easypost_wallet_topups(status);
create index if not exists canvas_easypost_wallet_topups_stripe_session_id_idx
  on public.canvas_easypost_wallet_topups(stripe_session_id);
alter table public.canvas_easypost_wallet_topups enable row level security;

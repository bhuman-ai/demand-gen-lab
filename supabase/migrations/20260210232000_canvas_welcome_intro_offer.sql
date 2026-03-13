-- Welcome intro offer: artist opt-in on artwork + one-time renter redemption tracking.

alter table public.canvas_artworks
  add column if not exists intro_offer_enabled boolean not null default false,
  add column if not exists intro_offer_days integer not null default 14;
alter table public.canvas_artworks
  drop constraint if exists canvas_artworks_intro_offer_days_check;
alter table public.canvas_artworks
  add constraint canvas_artworks_intro_offer_days_check
  check (intro_offer_days >= 0 and intro_offer_days <= 31);
create index if not exists canvas_artworks_intro_offer_enabled_idx
  on public.canvas_artworks(intro_offer_enabled, status);
alter table public.canvas_checkout_sessions
  add column if not exists promo_offer_days integer,
  add column if not exists promo_credit_amount integer not null default 0,
  add column if not exists promo_source text;
alter table public.canvas_checkout_sessions
  drop constraint if exists canvas_checkout_sessions_promo_credit_amount_check;
alter table public.canvas_checkout_sessions
  add constraint canvas_checkout_sessions_promo_credit_amount_check
  check (promo_credit_amount >= 0);
create table if not exists public.canvas_welcome_offer_redemptions (
  id uuid primary key default gen_random_uuid(),
  renter_id uuid not null references public.canvas_users(id) on delete cascade,
  artwork_id uuid not null references public.canvas_artworks(id) on delete cascade,
  checkout_session_id uuid references public.canvas_checkout_sessions(id) on delete set null,
  applied_days integer not null,
  credit_amount integer not null,
  created_at timestamptz not null default now(),
  constraint canvas_welcome_offer_redemptions_applied_days_check check (applied_days > 0 and applied_days <= 31),
  constraint canvas_welcome_offer_redemptions_credit_amount_check check (credit_amount >= 0)
);
create unique index if not exists canvas_welcome_offer_redemptions_renter_id_unique
  on public.canvas_welcome_offer_redemptions(renter_id);
create index if not exists canvas_welcome_offer_redemptions_artwork_id_idx
  on public.canvas_welcome_offer_redemptions(artwork_id);
create index if not exists canvas_welcome_offer_redemptions_checkout_session_idx
  on public.canvas_welcome_offer_redemptions(checkout_session_id);
alter table public.canvas_welcome_offer_redemptions enable row level security;

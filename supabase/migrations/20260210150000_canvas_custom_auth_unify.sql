-- Align core app tables to custom OTP identities (canvas_users).
-- The mobile app uses server APIs (service role) and does not rely on Supabase Auth sessions.

-- Artworks: replace auth.users FK with canvas_users.
alter table public.canvas_artworks
  drop constraint if exists canvas_artworks_artist_id_fkey;
alter table public.canvas_artworks
  add constraint canvas_artworks_artist_id_fkey
  foreign key (artist_id) references public.canvas_users(id) on delete cascade
  not valid;
-- Rentals: replace auth.users FK with canvas_users.
alter table public.canvas_rentals
  drop constraint if exists canvas_rentals_renter_id_fkey;
alter table public.canvas_rentals
  add constraint canvas_rentals_renter_id_fkey
  foreign key (renter_id) references public.canvas_users(id) on delete cascade
  not valid;
-- Payouts: replace auth.users FK with canvas_users.
alter table public.canvas_payouts
  drop constraint if exists canvas_payouts_artist_id_fkey;
alter table public.canvas_payouts
  add constraint canvas_payouts_artist_id_fkey
  foreign key (artist_id) references public.canvas_users(id) on delete cascade
  not valid;
-- Notifications: replace auth.users FK with canvas_users.
alter table public.canvas_notifications
  drop constraint if exists canvas_notifications_user_id_fkey;
alter table public.canvas_notifications
  add constraint canvas_notifications_user_id_fkey
  foreign key (user_id) references public.canvas_users(id) on delete cascade
  not valid;
-- Support tickets: replace auth.users FK with canvas_users.
alter table public.canvas_support_tickets
  drop constraint if exists canvas_support_tickets_user_id_fkey;
alter table public.canvas_support_tickets
  add constraint canvas_support_tickets_user_id_fkey
  foreign key (user_id) references public.canvas_users(id) on delete cascade
  not valid;
-- Condition captures: rebuild to avoid auth.uid() defaults and Supabase-auth-only policies.
drop table if exists public.canvas_condition_captures;
create table if not exists public.canvas_condition_captures (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.canvas_rentals(id) on delete cascade,
  user_id uuid not null references public.canvas_users(id) on delete cascade,
  step integer not null,
  image_url text not null,
  created_at timestamptz not null default now()
);
alter table public.canvas_condition_captures enable row level security;
-- Shipping: add party + rental linkage so renter + artist can both see the same shipment.
alter table public.canvas_shipments
  add column if not exists created_by uuid references public.canvas_users(id) on delete set null,
  add column if not exists renter_id uuid references public.canvas_users(id) on delete set null,
  add column if not exists artist_id uuid references public.canvas_users(id) on delete set null,
  add column if not exists rental_id uuid references public.canvas_rentals(id) on delete set null,
  add column if not exists artwork_id uuid references public.canvas_artworks(id) on delete set null;
create index if not exists canvas_shipments_created_by_idx on public.canvas_shipments(created_by);
create index if not exists canvas_shipments_renter_id_idx on public.canvas_shipments(renter_id);
create index if not exists canvas_shipments_artist_id_idx on public.canvas_shipments(artist_id);
create index if not exists canvas_shipments_rental_id_idx on public.canvas_shipments(rental_id);
create index if not exists canvas_shipments_artwork_id_idx on public.canvas_shipments(artwork_id);

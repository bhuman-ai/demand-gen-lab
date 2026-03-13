-- Core schema for Umber (prefix: canvas_)

do $$ begin
  create type canvas_role as enum ('renter', 'artist', 'both');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_artwork_status as enum ('draft', 'listed', 'on_loan', 'archived');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_rental_status as enum ('active', 'scheduled_return', 'returned', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type canvas_payout_status as enum ('pending', 'processing', 'paid', 'failed');
exception when duplicate_object then null; end $$;
create or replace function canvas_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
create table if not exists canvas_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role canvas_role not null default 'renter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists canvas_artworks (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  medium text,
  dimensions text,
  rent_price integer not null,
  buy_price integer not null,
  status canvas_artwork_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists canvas_rentals (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references canvas_artworks(id) on delete cascade,
  renter_id uuid not null references auth.users(id) on delete cascade,
  monthly_rent integer not null,
  security_hold integer not null,
  start_date date,
  end_date date,
  status canvas_rental_status not null default 'active',
  created_at timestamptz not null default now()
);
create table if not exists canvas_payouts (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  status canvas_payout_status not null default 'pending',
  scheduled_at date,
  created_at timestamptz not null default now()
);
create table if not exists canvas_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text,
  action text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists canvas_artworks_artist_id_idx on canvas_artworks(artist_id);
create index if not exists canvas_rentals_artwork_id_idx on canvas_rentals(artwork_id);
create index if not exists canvas_rentals_renter_id_idx on canvas_rentals(renter_id);
create index if not exists canvas_payouts_artist_id_idx on canvas_payouts(artist_id);
create index if not exists canvas_notifications_user_id_idx on canvas_notifications(user_id);
drop trigger if exists canvas_profiles_set_updated_at on canvas_profiles;
create trigger canvas_profiles_set_updated_at
before update on canvas_profiles
for each row execute function canvas_set_updated_at();
drop trigger if exists canvas_artworks_set_updated_at on canvas_artworks;
create trigger canvas_artworks_set_updated_at
before update on canvas_artworks
for each row execute function canvas_set_updated_at();
alter table canvas_profiles enable row level security;
alter table canvas_artworks enable row level security;
alter table canvas_rentals enable row level security;
alter table canvas_payouts enable row level security;
alter table canvas_notifications enable row level security;
drop policy if exists "canvas_profiles_select_own" on canvas_profiles;
create policy "canvas_profiles_select_own"
  on canvas_profiles for select
  using (auth.uid() = id);
drop policy if exists "canvas_profiles_insert_own" on canvas_profiles;
create policy "canvas_profiles_insert_own"
  on canvas_profiles for insert
  with check (auth.uid() = id);
drop policy if exists "canvas_profiles_update_own" on canvas_profiles;
create policy "canvas_profiles_update_own"
  on canvas_profiles for update
  using (auth.uid() = id);
drop policy if exists "canvas_artworks_select_listed_or_own" on canvas_artworks;
create policy "canvas_artworks_select_listed_or_own"
  on canvas_artworks for select
  using (status = 'listed' or artist_id = auth.uid());
drop policy if exists "canvas_artworks_insert_own" on canvas_artworks;
create policy "canvas_artworks_insert_own"
  on canvas_artworks for insert
  with check (artist_id = auth.uid());
drop policy if exists "canvas_artworks_update_own" on canvas_artworks;
create policy "canvas_artworks_update_own"
  on canvas_artworks for update
  using (artist_id = auth.uid())
  with check (artist_id = auth.uid());
drop policy if exists "canvas_artworks_delete_own" on canvas_artworks;
create policy "canvas_artworks_delete_own"
  on canvas_artworks for delete
  using (artist_id = auth.uid());
drop policy if exists "canvas_rentals_select_own" on canvas_rentals;
create policy "canvas_rentals_select_own"
  on canvas_rentals for select
  using (
    renter_id = auth.uid()
    or exists (
      select 1 from canvas_artworks a
      where a.id = canvas_rentals.artwork_id and a.artist_id = auth.uid()
    )
  );
drop policy if exists "canvas_rentals_insert_own" on canvas_rentals;
create policy "canvas_rentals_insert_own"
  on canvas_rentals for insert
  with check (renter_id = auth.uid());
drop policy if exists "canvas_rentals_update_own" on canvas_rentals;
create policy "canvas_rentals_update_own"
  on canvas_rentals for update
  using (renter_id = auth.uid());
drop policy if exists "canvas_payouts_select_own" on canvas_payouts;
create policy "canvas_payouts_select_own"
  on canvas_payouts for select
  using (artist_id = auth.uid());
drop policy if exists "canvas_payouts_update_own" on canvas_payouts;
create policy "canvas_payouts_update_own"
  on canvas_payouts for update
  using (artist_id = auth.uid());
drop policy if exists "canvas_notifications_select_own" on canvas_notifications;
create policy "canvas_notifications_select_own"
  on canvas_notifications for select
  using (user_id = auth.uid());
drop policy if exists "canvas_notifications_update_own" on canvas_notifications;
create policy "canvas_notifications_update_own"
  on canvas_notifications for update
  using (user_id = auth.uid());

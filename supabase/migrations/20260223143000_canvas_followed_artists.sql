-- Persisted artist follows per user.

create table if not exists public.canvas_followed_artists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.canvas_users(id) on delete cascade,
  artist_key text not null,
  artist_name text not null,
  created_at timestamptz not null default now()
);
alter table public.canvas_followed_artists enable row level security;
create unique index if not exists canvas_followed_artists_user_artist_key
  on public.canvas_followed_artists(user_id, artist_key);
create index if not exists canvas_followed_artists_user_created_idx
  on public.canvas_followed_artists(user_id, created_at desc);
drop policy if exists "canvas_followed_artists_select_own" on public.canvas_followed_artists;
create policy "canvas_followed_artists_select_own"
  on public.canvas_followed_artists for select
  using (user_id = auth.uid());
drop policy if exists "canvas_followed_artists_insert_own" on public.canvas_followed_artists;
create policy "canvas_followed_artists_insert_own"
  on public.canvas_followed_artists for insert
  with check (user_id = auth.uid());
drop policy if exists "canvas_followed_artists_delete_own" on public.canvas_followed_artists;
create policy "canvas_followed_artists_delete_own"
  on public.canvas_followed_artists for delete
  using (user_id = auth.uid());

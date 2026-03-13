-- Persisted shortlist / saved artworks per user.

create table if not exists public.canvas_saved_artworks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.canvas_users(id) on delete cascade,
  artwork_id uuid references public.canvas_artworks(id) on delete cascade,
  sourced_artwork_id uuid references public.canvas_sourced_artworks(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint canvas_saved_artworks_exactly_one_check check (
    (artwork_id is not null and sourced_artwork_id is null)
    or (artwork_id is null and sourced_artwork_id is not null)
  )
);
alter table public.canvas_saved_artworks enable row level security;
create unique index if not exists canvas_saved_artworks_user_artwork_key
  on public.canvas_saved_artworks(user_id, artwork_id)
  where artwork_id is not null;
create unique index if not exists canvas_saved_artworks_user_sourced_key
  on public.canvas_saved_artworks(user_id, sourced_artwork_id)
  where sourced_artwork_id is not null;
create index if not exists canvas_saved_artworks_user_created_idx
  on public.canvas_saved_artworks(user_id, created_at desc);
drop policy if exists "canvas_saved_artworks_select_own" on public.canvas_saved_artworks;
create policy "canvas_saved_artworks_select_own"
  on public.canvas_saved_artworks for select
  using (user_id = auth.uid());
drop policy if exists "canvas_saved_artworks_insert_own" on public.canvas_saved_artworks;
create policy "canvas_saved_artworks_insert_own"
  on public.canvas_saved_artworks for insert
  with check (user_id = auth.uid());
drop policy if exists "canvas_saved_artworks_delete_own" on public.canvas_saved_artworks;
create policy "canvas_saved_artworks_delete_own"
  on public.canvas_saved_artworks for delete
  using (user_id = auth.uid());

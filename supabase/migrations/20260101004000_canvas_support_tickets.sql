create table if not exists canvas_support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  details text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create index if not exists canvas_support_tickets_user_id_idx on canvas_support_tickets(user_id);
alter table canvas_support_tickets enable row level security;
drop policy if exists "canvas_support_tickets_select_own" on canvas_support_tickets;
create policy "canvas_support_tickets_select_own"
  on canvas_support_tickets for select
  using (auth.uid() = user_id);
drop policy if exists "canvas_support_tickets_insert_own" on canvas_support_tickets;
create policy "canvas_support_tickets_insert_own"
  on canvas_support_tickets for insert
  with check (auth.uid() = user_id);

create table if not exists public.canvas_condition_captures (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.canvas_rentals(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  step integer not null,
  image_url text not null,
  created_at timestamptz not null default now()
);
alter table public.canvas_condition_captures enable row level security;
insert into storage.buckets (id, name, public)
values ('canvas-condition', 'canvas-condition', true)
on conflict (id) do nothing;
drop policy if exists "Users can insert own condition captures" on public.canvas_condition_captures;
create policy "Users can insert own condition captures" on public.canvas_condition_captures
  for insert
  to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "Users can view own condition captures" on public.canvas_condition_captures;
create policy "Users can view own condition captures" on public.canvas_condition_captures
  for select
  to authenticated
  using (auth.uid() = user_id);
-- Storage policies for condition capture uploads
drop policy if exists "Condition captures upload" on storage.objects;
create policy "Condition captures upload" on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'canvas-condition' and auth.uid() = owner);
drop policy if exists "Condition captures read" on storage.objects;
create policy "Condition captures read" on storage.objects
  for select
  to authenticated
  using (bucket_id = 'canvas-condition');

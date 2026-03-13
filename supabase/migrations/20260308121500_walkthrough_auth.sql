alter table public.update_capture_profiles
  add column if not exists last_auth_primary_method text,
  add column if not exists last_auth_account_intent text,
  add column if not exists last_auth_session_policy text;
create table if not exists public.update_capture_job_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  brand_id uuid not null references public.update_brands(id) on delete cascade,
  capture_job_id uuid not null references public.update_capture_jobs(id) on delete cascade,
  encrypted_payload text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (capture_job_id)
);
create trigger update_update_capture_job_secrets_updated_at
before update on public.update_capture_job_secrets
for each row execute function public.update_updated_at_column();
alter table public.update_capture_job_secrets enable row level security;
do $policies$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_job_secrets' and policyname = 'update_capture_job_secrets_select_own'
  ) then
    create policy update_capture_job_secrets_select_own on public.update_capture_job_secrets
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_job_secrets' and policyname = 'update_capture_job_secrets_insert_own'
  ) then
    create policy update_capture_job_secrets_insert_own on public.update_capture_job_secrets
      for insert with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_job_secrets' and policyname = 'update_capture_job_secrets_update_own'
  ) then
    create policy update_capture_job_secrets_update_own on public.update_capture_job_secrets
      for update using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_job_secrets' and policyname = 'update_capture_job_secrets_delete_own'
  ) then
    create policy update_capture_job_secrets_delete_own on public.update_capture_job_secrets
      for delete using (user_id = auth.uid());
  end if;
end
$policies$;
create table if not exists public.update_capture_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  brand_id uuid not null references public.update_brands(id) on delete cascade,
  auth_fingerprint text not null,
  session_label text,
  session_policy text not null default 'run_only',
  encrypted_storage_state text not null,
  auth_summary jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  last_validated_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, auth_fingerprint)
);
create trigger update_update_capture_auth_sessions_updated_at
before update on public.update_capture_auth_sessions
for each row execute function public.update_updated_at_column();
alter table public.update_capture_auth_sessions enable row level security;
do $policies$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_auth_sessions' and policyname = 'update_capture_auth_sessions_select_own'
  ) then
    create policy update_capture_auth_sessions_select_own on public.update_capture_auth_sessions
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_auth_sessions' and policyname = 'update_capture_auth_sessions_insert_own'
  ) then
    create policy update_capture_auth_sessions_insert_own on public.update_capture_auth_sessions
      for insert with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_auth_sessions' and policyname = 'update_capture_auth_sessions_update_own'
  ) then
    create policy update_capture_auth_sessions_update_own on public.update_capture_auth_sessions
      for update using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_auth_sessions' and policyname = 'update_capture_auth_sessions_delete_own'
  ) then
    create policy update_capture_auth_sessions_delete_own on public.update_capture_auth_sessions
      for delete using (user_id = auth.uid());
  end if;
end
$policies$;

-- OpenClaw capture queue for walkthrough generation
-- Adds capture profiles, encrypted secrets, queue jobs, and artifact traceability.

create table if not exists public.update_capture_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  brand_id uuid not null references public.update_brands(id) on delete cascade,
  target_platform text not null default 'mobile_web'
    check (target_platform in ('mobile_web', 'desktop_web')),
  viewport jsonb not null default '{"width":390,"height":844}'::jsonb,
  base_url text,
  login_mode text not null default 'scripted'
    check (login_mode in ('none', 'scripted')),
  login_script jsonb not null default '[]'::jsonb,
  route_allowlist text[] not null default '{}'::text[],
  route_blocklist text[] not null default '{}'::text[],
  modal_hints jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id)
);
create trigger update_update_capture_profiles_updated_at
before update on public.update_capture_profiles
for each row execute function public.update_updated_at_column();
alter table public.update_capture_profiles enable row level security;
do $policies$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_profiles' and policyname = 'update_capture_profiles_select_own'
  ) then
    create policy update_capture_profiles_select_own on public.update_capture_profiles
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_profiles' and policyname = 'update_capture_profiles_insert_own'
  ) then
    create policy update_capture_profiles_insert_own on public.update_capture_profiles
      for insert with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_profiles' and policyname = 'update_capture_profiles_update_own'
  ) then
    create policy update_capture_profiles_update_own on public.update_capture_profiles
      for update using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_profiles' and policyname = 'update_capture_profiles_delete_own'
  ) then
    create policy update_capture_profiles_delete_own on public.update_capture_profiles
      for delete using (user_id = auth.uid());
  end if;
end
$policies$;
create table if not exists public.update_capture_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  brand_id uuid not null references public.update_brands(id) on delete cascade,
  encrypted_payload text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id)
);
create trigger update_update_capture_secrets_updated_at
before update on public.update_capture_secrets
for each row execute function public.update_updated_at_column();
alter table public.update_capture_secrets enable row level security;
do $policies$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_secrets' and policyname = 'update_capture_secrets_select_own'
  ) then
    create policy update_capture_secrets_select_own on public.update_capture_secrets
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_secrets' and policyname = 'update_capture_secrets_insert_own'
  ) then
    create policy update_capture_secrets_insert_own on public.update_capture_secrets
      for insert with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_secrets' and policyname = 'update_capture_secrets_update_own'
  ) then
    create policy update_capture_secrets_update_own on public.update_capture_secrets
      for update using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_secrets' and policyname = 'update_capture_secrets_delete_own'
  ) then
    create policy update_capture_secrets_delete_own on public.update_capture_secrets
      for delete using (user_id = auth.uid());
  end if;
end
$policies$;
create table if not exists public.update_capture_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  brand_id uuid not null references public.update_brands(id) on delete cascade,
  plan_id uuid not null references public.update_video_plans(id) on delete cascade,
  digest_id uuid references public.update_digests(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'uploading', 'rendering', 'completed', 'failed', 'cancelled')),
  priority int not null default 100,
  attempt int not null default 0,
  max_attempts int not null default 2,
  requested_platform text not null default 'mobile_web'
    check (requested_platform in ('mobile_web', 'desktop_web')),
  flow_map jsonb not null default '{}'::jsonb,
  walkthrough_brief text,
  planner_prompt text,
  capture_plan jsonb,
  progress jsonb not null default '{}'::jsonb,
  error text,
  worker_id text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_update_capture_jobs_status_priority_created
  on public.update_capture_jobs(status, priority, created_at);
create index if not exists idx_update_capture_jobs_user_brand_created
  on public.update_capture_jobs(user_id, brand_id, created_at desc);
create index if not exists idx_update_capture_jobs_plan
  on public.update_capture_jobs(plan_id);
create trigger update_update_capture_jobs_updated_at
before update on public.update_capture_jobs
for each row execute function public.update_updated_at_column();
alter table public.update_capture_jobs enable row level security;
do $policies$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_jobs' and policyname = 'update_capture_jobs_select_own'
  ) then
    create policy update_capture_jobs_select_own on public.update_capture_jobs
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_jobs' and policyname = 'update_capture_jobs_insert_own'
  ) then
    create policy update_capture_jobs_insert_own on public.update_capture_jobs
      for insert with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_jobs' and policyname = 'update_capture_jobs_update_own'
  ) then
    create policy update_capture_jobs_update_own on public.update_capture_jobs
      for update using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_jobs' and policyname = 'update_capture_jobs_delete_own'
  ) then
    create policy update_capture_jobs_delete_own on public.update_capture_jobs
      for delete using (user_id = auth.uid());
  end if;
end
$policies$;
create table if not exists public.update_capture_artifacts (
  id uuid primary key default gen_random_uuid(),
  capture_job_id uuid not null references public.update_capture_jobs(id) on delete cascade,
  asset_id uuid references public.update_assets(id) on delete set null,
  kind text not null check (kind in ('video', 'image', 'trace', 'log')),
  url text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_update_capture_artifacts_job on public.update_capture_artifacts(capture_job_id);
alter table public.update_capture_artifacts enable row level security;
do $policies$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_artifacts' and policyname = 'update_capture_artifacts_select_own'
  ) then
    create policy update_capture_artifacts_select_own on public.update_capture_artifacts
      for select using (
        exists (
          select 1 from public.update_capture_jobs j
          where j.id = update_capture_artifacts.capture_job_id and j.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_artifacts' and policyname = 'update_capture_artifacts_insert_own'
  ) then
    create policy update_capture_artifacts_insert_own on public.update_capture_artifacts
      for insert with check (
        exists (
          select 1 from public.update_capture_jobs j
          where j.id = update_capture_artifacts.capture_job_id and j.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_artifacts' and policyname = 'update_capture_artifacts_update_own'
  ) then
    create policy update_capture_artifacts_update_own on public.update_capture_artifacts
      for update using (
        exists (
          select 1 from public.update_capture_jobs j
          where j.id = update_capture_artifacts.capture_job_id and j.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'update_capture_artifacts' and policyname = 'update_capture_artifacts_delete_own'
  ) then
    create policy update_capture_artifacts_delete_own on public.update_capture_artifacts
      for delete using (
        exists (
          select 1 from public.update_capture_jobs j
          where j.id = update_capture_artifacts.capture_job_id and j.user_id = auth.uid()
        )
      );
  end if;
end
$policies$;

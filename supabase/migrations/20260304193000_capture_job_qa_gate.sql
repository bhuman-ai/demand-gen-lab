-- Walkthrough QA + idempotent capture job queue support

alter table public.update_capture_jobs
  add column if not exists idempotency_key text;
alter table public.update_capture_jobs
  add column if not exists qa_status text not null default 'pending';
alter table public.update_capture_jobs
  add column if not exists qa_report jsonb not null default '{}'::jsonb;
alter table public.update_capture_jobs
  add column if not exists qa_attempt int not null default 0;
alter table public.update_capture_jobs
  add column if not exists parent_capture_job_id uuid references public.update_capture_jobs(id) on delete set null;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'update_capture_jobs_qa_status_check'
  ) then
    alter table public.update_capture_jobs
      add constraint update_capture_jobs_qa_status_check
      check (qa_status in ('pending', 'running', 'passed', 'failed', 'needs_review'));
  end if;
end
$$;
create unique index if not exists idx_update_capture_jobs_active_idempotency
  on public.update_capture_jobs(idempotency_key)
  where idempotency_key is not null
    and status in ('queued', 'running', 'uploading', 'rendering');
create index if not exists idx_update_capture_jobs_plan_qa_status_created
  on public.update_capture_jobs(plan_id, qa_status, created_at desc);

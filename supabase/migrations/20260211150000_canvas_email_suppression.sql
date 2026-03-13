-- Global email suppression list for outreach compliance.

create table if not exists public.canvas_email_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  reason text,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);
create unique index if not exists canvas_email_suppressions_email_key
  on public.canvas_email_suppressions(lower(email));
create index if not exists canvas_email_suppressions_created_at_idx
  on public.canvas_email_suppressions(created_at desc);
alter table public.canvas_email_suppressions enable row level security;

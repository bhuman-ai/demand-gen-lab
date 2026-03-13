-- Admin-managed outreach automation settings.

create table if not exists public.canvas_outreach_settings (
  id integer primary key default 1 check (id = 1),
  artists_enabled boolean not null default true,
  artists_daily_limit integer not null default 40 check (artists_daily_limit between 1 and 5000),
  decorators_enabled boolean not null default true,
  decorators_daily_cap integer not null default 50 check (decorators_daily_cap between 1 and 5000),
  decorators_batch_size integer not null default 50 check (decorators_batch_size between 1 and 5000),
  decorators_strict_icp boolean not null default true,
  enforce_city_readiness boolean not null default true,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.canvas_outreach_settings (id)
values (1)
on conflict (id) do nothing;
drop trigger if exists canvas_outreach_settings_set_updated_at on public.canvas_outreach_settings;
create trigger canvas_outreach_settings_set_updated_at
before update on public.canvas_outreach_settings
for each row execute function canvas_set_updated_at();
alter table public.canvas_outreach_settings enable row level security;

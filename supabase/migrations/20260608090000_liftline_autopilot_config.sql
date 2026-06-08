alter table if exists public.demanddev_brands
  add column if not exists liftline_autopilot_config jsonb not null default '{}'::jsonb;

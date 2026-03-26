alter table if exists public.demanddev_sender_launches
  add column if not exists autopilot_mode text not null default 'curated_plus_open_web',
  add column if not exists autopilot_allowed_domains text[] not null default '{}',
  add column if not exists autopilot_blocked_domains text[] not null default '{}';

update public.demanddev_sender_launches
set
  autopilot_mode = coalesce(nullif(autopilot_mode, ''), 'curated_plus_open_web'),
  autopilot_allowed_domains = coalesce(autopilot_allowed_domains, '{}'),
  autopilot_blocked_domains = coalesce(autopilot_blocked_domains, '{}')
where
  autopilot_mode is null
  or autopilot_mode = ''
  or autopilot_allowed_domains is null
  or autopilot_blocked_domains is null;

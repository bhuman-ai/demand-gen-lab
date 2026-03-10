create table if not exists demanddev_outreach_provisioning_settings (
  id text primary key,
  config jsonb not null default '{}'::jsonb,
  credentials_encrypted text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists demanddev_outreach_provisioning_settings_updated_at on demanddev_outreach_provisioning_settings;
create trigger demanddev_outreach_provisioning_settings_updated_at
before update on demanddev_outreach_provisioning_settings
for each row execute function demanddev_set_updated_at();

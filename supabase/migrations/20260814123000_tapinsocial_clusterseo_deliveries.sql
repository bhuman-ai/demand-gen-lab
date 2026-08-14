create table if not exists demanddev_tapinsocial_network_deliveries (
  id uuid primary key default gen_random_uuid(),
  mission_id text not null unique,
  event_id uuid not null unique,
  tapin_user_id uuid not null,
  brand_id text not null,
  account_id text not null,
  channel_id text not null,
  video_url text not null,
  comment_text text not null,
  text_hash text not null,
  delivery_token text not null,
  status text not null default 'posting'
    check (status in ('posting', 'posted', 'posted_unverified', 'settled', 'failed')),
  comment_id text,
  comment_url text,
  posted_at timestamptz,
  settled_at timestamptz,
  settlement jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demanddev_tapinsocial_network_deliveries_user_status_idx
  on demanddev_tapinsocial_network_deliveries (tapin_user_id, status, created_at desc);

alter table demanddev_tapinsocial_network_deliveries enable row level security;

comment on table demanddev_tapinsocial_network_deliveries is
  'Service-role-only idempotency ledger for human-approved TapInSocial YouTube comments sourced from ClusterSEO.';

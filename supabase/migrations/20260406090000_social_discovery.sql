create table if not exists demanddev_social_discovery_posts (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  platform text not null check (platform in ('reddit', 'instagram')),
  provider text not null default 'exa' check (provider in ('exa', 'dataforseo')),
  external_id text not null,
  url text not null default '',
  title text not null default '',
  body text not null default '',
  author text not null default '',
  community text not null default '',
  query text not null default '',
  matched_terms text[] not null default '{}'::text[],
  intent text not null default 'noise' check (intent in ('brand_mention', 'buyer_question', 'competitor_complaint', 'category_intent', 'noise')),
  relevance_score numeric not null default 0,
  rising_score numeric not null default 0,
  engagement_score numeric not null default 0,
  provider_rank numeric not null default 0,
  status text not null default 'new' check (status in ('new', 'triaged', 'saved', 'dismissed')),
  interaction_plan jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  posted_at timestamptz,
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, platform, external_id)
);

alter table demanddev_social_discovery_posts
  add column if not exists provider text not null default 'exa',
  add column if not exists rising_score numeric not null default 0,
  add column if not exists provider_rank numeric not null default 0,
  add column if not exists interaction_plan jsonb not null default '{}'::jsonb;

create index if not exists demanddev_social_discovery_posts_brand_status_idx
  on demanddev_social_discovery_posts (brand_id, status, rising_score desc, relevance_score desc, discovered_at desc);

create index if not exists demanddev_social_discovery_posts_platform_idx
  on demanddev_social_discovery_posts (platform, discovered_at desc);

create index if not exists demanddev_social_discovery_posts_intent_idx
  on demanddev_social_discovery_posts (brand_id, intent, relevance_score desc);

drop trigger if exists demanddev_social_discovery_posts_updated_at on demanddev_social_discovery_posts;
create trigger demanddev_social_discovery_posts_updated_at
before update on demanddev_social_discovery_posts
for each row execute function demanddev_set_updated_at();

create table if not exists demanddev_social_discovery_runs (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  provider text not null default 'exa' check (provider in ('exa', 'dataforseo')),
  platforms text[] not null default '{}'::text[],
  queries text[] not null default '{}'::text[],
  post_ids text[] not null default '{}'::text[],
  error_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);

alter table demanddev_social_discovery_runs
  add column if not exists provider text not null default 'exa';

create index if not exists demanddev_social_discovery_runs_brand_started_idx
  on demanddev_social_discovery_runs (brand_id, started_at desc);

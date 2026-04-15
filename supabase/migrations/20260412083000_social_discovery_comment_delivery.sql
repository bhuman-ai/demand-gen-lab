alter table demanddev_social_discovery_posts
  add column if not exists comment_delivery jsonb not null default '{}'::jsonb;

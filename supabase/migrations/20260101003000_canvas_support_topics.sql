create table if not exists canvas_support_topics (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  icon text not null,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists canvas_support_topics_label_idx on canvas_support_topics(label);
alter table canvas_support_topics enable row level security;
drop policy if exists "canvas_support_topics_select_all" on canvas_support_topics;
create policy "canvas_support_topics_select_all"
  on canvas_support_topics for select
  using (true);

create table if not exists public.canvas_artist_profile_translations (
  id uuid primary key default gen_random_uuid(),
  artist_key text not null,
  artist_name text not null,
  source_hash text not null,
  language_code text not null,
  about_text text not null,
  inspiration_text text,
  based_text text,
  medium_focus_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists canvas_artist_profile_translations_unique_key
  on public.canvas_artist_profile_translations(artist_key, source_hash, language_code);
create index if not exists canvas_artist_profile_translations_artist_idx
  on public.canvas_artist_profile_translations(artist_key, created_at desc);
drop trigger if exists canvas_artist_profile_translations_set_updated_at on public.canvas_artist_profile_translations;
create trigger canvas_artist_profile_translations_set_updated_at
before update on public.canvas_artist_profile_translations
for each row execute function canvas_set_updated_at();
alter table public.canvas_artist_profile_translations enable row level security;

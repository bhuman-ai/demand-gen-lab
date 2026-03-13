-- Add Instagram enrichment fields for sourced lead/contact discovery.

alter table public.canvas_artist_leads
  add column if not exists instagram_profile_url text,
  add column if not exists instagram_username text,
  add column if not exists instagram_public_phone text;
alter table public.canvas_sourced_artworks
  add column if not exists instagram_profile_url text,
  add column if not exists instagram_username text,
  add column if not exists instagram_public_phone text;
create index if not exists canvas_artist_leads_instagram_username_idx
  on public.canvas_artist_leads(lower(coalesce(instagram_username, '')));
create index if not exists canvas_sourced_artworks_instagram_username_idx
  on public.canvas_sourced_artworks(lower(coalesce(instagram_username, '')));

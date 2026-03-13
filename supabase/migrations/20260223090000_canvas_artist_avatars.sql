-- Add optional avatar/profile image URLs for native and sourced artists.

alter table public.canvas_user_profiles
  add column if not exists avatar_url text;
alter table public.canvas_artist_leads
  add column if not exists profile_image_url text;
alter table public.canvas_sourced_artworks
  add column if not exists profile_image_url text;

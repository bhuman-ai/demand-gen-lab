alter table canvas_artworks
  add column if not exists artist_name text,
  add column if not exists image_url text;

alter table canvas_artworks
  add column if not exists width_cm numeric,
  add column if not exists height_cm numeric,
  add column if not exists glb_url text,
  add column if not exists usdz_url text;

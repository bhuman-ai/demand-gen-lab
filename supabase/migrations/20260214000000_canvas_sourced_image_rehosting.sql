-- Rehost sourced artwork images in Supabase Storage for reliable rendering.

alter table public.canvas_sourced_artworks
  add column if not exists image_source_url text,
  add column if not exists image_storage_path text;
insert into storage.buckets (id, name, public)
values ('umber-artwork-images', 'umber-artwork-images', true)
on conflict (id) do nothing;
-- Allow storage API reads for public bucket objects.
drop policy if exists "Umber artwork images read" on storage.objects;
create policy "Umber artwork images read" on storage.objects
  for select
  to public
  using (bucket_id = 'umber-artwork-images');

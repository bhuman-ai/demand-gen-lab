-- Backfill deterministic avatar URLs for existing records missing profile images.
-- Uses DiceBear seeded by stable hashes so URLs are deterministic and idempotent.

update public.canvas_user_profiles
set avatar_url =
  'https://api.dicebear.com/9.x/initials/png?seed='
  || md5(coalesce(nullif(trim(full_name), ''), user_id::text))
  || '&radius=50&backgroundType=gradientLinear'
where avatar_url is null;
update public.canvas_artist_leads
set profile_image_url =
  'https://api.dicebear.com/9.x/initials/png?seed='
  || md5(
    coalesce(
      nullif(trim(artist_name), ''),
      nullif(trim(contact_name), ''),
      nullif(trim(profile_url), ''),
      id::text
    )
  )
  || '&radius=50&backgroundType=gradientLinear'
where profile_image_url is null;
update public.canvas_sourced_artworks as s
set profile_image_url = l.profile_image_url
from public.canvas_artist_leads as l
where s.profile_image_url is null
  and s.lead_id = l.id
  and l.profile_image_url is not null;
update public.canvas_sourced_artworks
set profile_image_url =
  'https://api.dicebear.com/9.x/initials/png?seed='
  || md5(
    coalesce(
      nullif(trim(artist_name), ''),
      nullif(trim(title), ''),
      id::text
    )
  )
  || '&radius=50&backgroundType=gradientLinear'
where profile_image_url is null;

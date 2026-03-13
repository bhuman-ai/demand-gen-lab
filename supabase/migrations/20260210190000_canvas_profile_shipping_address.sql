-- Add a JSONB shipping address to custom-auth profiles.

alter table public.canvas_user_profiles
  add column if not exists shipping_address jsonb;

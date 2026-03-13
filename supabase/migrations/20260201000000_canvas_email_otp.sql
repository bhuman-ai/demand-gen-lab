-- Email OTP auth tables (custom auth for Umber)

create table if not exists canvas_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists canvas_user_profiles (
  user_id uuid primary key references canvas_users(id) on delete cascade,
  full_name text,
  phone text,
  role canvas_role not null default 'renter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists canvas_otp_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists canvas_users_email_idx on canvas_users(email);
create index if not exists canvas_otp_requests_email_idx on canvas_otp_requests(email);
create index if not exists canvas_otp_requests_expires_idx on canvas_otp_requests(expires_at);
drop trigger if exists canvas_user_profiles_set_updated_at on canvas_user_profiles;
create trigger canvas_user_profiles_set_updated_at
before update on canvas_user_profiles
for each row execute function canvas_set_updated_at();
alter table canvas_users enable row level security;
alter table canvas_user_profiles enable row level security;
alter table canvas_otp_requests enable row level security;

-- Customer signup: normalized phone dedup, optional referral handle, signup attempt audit

alter table public.profiles add column if not exists phone_normalized text;
alter table public.profiles add column if not exists referral_username text;

comment on column public.profiles.phone_normalized is 'Digits-only key for duplicate-phone prevention; derived from public.profiles.phone.';
comment on column public.profiles.referral_username is 'Optional @username the customer entered as referrer (not validated as FK).';

-- At most one non-rejected, non-deleted profile per normalized phone
create unique index if not exists idx_profiles_phone_norm_active
  on public.profiles (phone_normalized)
  where phone_normalized is not null
    and deleted_at is null
    and account_status in ('pending', 'approved', 'suspended', 'blocked');

create index if not exists idx_profiles_phone_norm_lookup
  on public.profiles (phone_normalized)
  where phone_normalized is not null and deleted_at is null;

-- Log signup attempts (including blocked duplicates) for abuse review
create table if not exists public.signup_phone_attempts (
  id uuid primary key default gen_random_uuid(),
  phone_normalized text,
  attempted_email text,
  attempted_username text,
  blocked boolean not null default false,
  block_reason text,
  client_ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_signup_phone_attempts_phone_created
  on public.signup_phone_attempts (phone_normalized, created_at desc);

alter table public.signup_phone_attempts enable row level security;

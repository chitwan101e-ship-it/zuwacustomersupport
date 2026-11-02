-- One free spin every 48 hours. The app writes this with the service role.
-- Customers can update avatar_url only, so they cannot clear the wait.

alter table public.profiles
  add column if not exists lucky_spin_at timestamptz;

comment on column public.profiles.lucky_spin_at is
  'When the customer last used the free spin. The next spin opens 48 hours later. A Try again counts.';

revoke update (lucky_spin_at) on table public.profiles from anon, authenticated;

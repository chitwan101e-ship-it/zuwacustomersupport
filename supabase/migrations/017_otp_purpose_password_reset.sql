-- Distinguish signup vs password-reset OTP rows; support auth lookup by email (service role).

alter table public.otp_tokens add column if not exists purpose text not null default 'signup';

alter table public.otp_tokens drop constraint if exists otp_tokens_purpose_check;
alter table public.otp_tokens add constraint otp_tokens_purpose_check
  check (purpose in ('signup', 'password_reset'));

create index if not exists idx_otp_tokens_email_purpose_active
  on public.otp_tokens (email, purpose)
  where used = false;

-- Returns auth.users.id for a login email (case-insensitive). Callable only by service_role.
create or replace function public.relay_auth_user_id_for_email(p_email text)
returns uuid
language sql
security definer
set search_path = auth
stable
as $$
  select u.id
  from auth.users u
  where lower(trim(u.email::text)) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.relay_auth_user_id_for_email(text) from public;
grant execute on function public.relay_auth_user_id_for_email(text) to service_role;

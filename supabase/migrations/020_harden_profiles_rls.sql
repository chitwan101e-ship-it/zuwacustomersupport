-- Fix critical profiles RLS: block privilege self-escalation (Vuln 1) and anonymous PII dump (Vuln 2).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_business_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'business'
      and business_id is not null
  );
$$;

-- ---------------------------------------------------------------------------
-- Drop insecure policies
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_own" on public.profiles;
drop policy if exists "profiles_read" on public.profiles;

-- ---------------------------------------------------------------------------
-- SELECT: least-privilege row access (authenticated only; anon has no grants)
-- ---------------------------------------------------------------------------
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_select_business_team"
  on public.profiles for select
  using (
    role = 'business'
    and business_id is not null
    and public.is_business_member(business_id)
  );

create policy "profiles_select_business_customers"
  on public.profiles for select
  using (
    role = 'customer'
    and account_status in ('approved', 'suspended')
    and deleted_at is null
    and (
      exists (
        select 1 from public.conversations c
        where c.customer_id = profiles.id
          and public.is_business_member(c.business_id)
      )
      or exists (
        select 1 from public.follows f
        where f.user_id = profiles.id
          and public.is_business_member(f.business_id)
      )
    )
  );

-- Business staff: list approved customers for announcements / notifications
create policy "profiles_select_business_broadcast"
  on public.profiles for select
  using (
    role = 'customer'
    and account_status = 'approved'
    and deleted_at is null
    and public.is_business_user()
  );

-- Feed / comments / messages: display names for approved customers and business staff
create policy "profiles_select_display"
  on public.profiles for select
  using (
    auth.uid() is not null
    and deleted_at is null
    and (
      role = 'business'
      or (role = 'customer' and account_status = 'approved')
    )
  );

-- ---------------------------------------------------------------------------
-- UPDATE: clients may only change avatar_url on their own row
-- ---------------------------------------------------------------------------
create policy "profiles_update_avatar_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Column + role grants: no anon access; hide phone from client role
-- ---------------------------------------------------------------------------
revoke all on table public.profiles from anon;
revoke update on table public.profiles from anon, authenticated;

grant select on table public.profiles to authenticated;
revoke select (phone, phone_normalized) on table public.profiles from authenticated;

grant update (avatar_url) on table public.profiles to authenticated;

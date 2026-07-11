-- Roll back RLS hardening changes that caused staff/customer visibility regressions.
-- Keep this migration idempotent so re-running it restores pre-016 behavior.

-- ---------------------------------------------------------------------------
-- 1) PROFILES: restore original broad read policy
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_read" on public.profiles;

create policy "profiles_read"
  on public.profiles for select
  using (true);

-- ---------------------------------------------------------------------------
-- 2) FOLLOWS: restore original broad read policy
-- ---------------------------------------------------------------------------
drop policy if exists "follows_read" on public.follows;

create policy "follows_read"
  on public.follows for select
  using (true);

-- ---------------------------------------------------------------------------
-- 3) NOTIFICATIONS INSERT: restore original business-member insert behavior
-- ---------------------------------------------------------------------------
drop policy if exists "notifications_insert" on public.notifications;

create policy "notifications_insert"
  on public.notifications for insert
  with check (
    user_id = auth.uid()
    or
    (
      notifications.business_id is not null
      and public.is_business_member(notifications.business_id)
    )
  );

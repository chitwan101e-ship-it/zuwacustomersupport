-- OPTIONAL — skip if SQL Editor times out. The app works without this index.
-- notifyEveryBusinessAdmin only scans a handful of admin rows; idx_profiles_business
-- already exists on business_id for other queries.
--
-- Apply only after the database is healthy (no statement timeouts in Logs).
-- If this fails again, leave it skipped — it is a minor optimization, not required.

create index if not exists idx_profiles_business_admins
  on public.profiles (business_id)
  where role = 'business'
    and business_role = 'admin'
    and deleted_at is null;

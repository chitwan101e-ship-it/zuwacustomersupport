-- Speed up pending-signup list/count queries under load.
-- REQUIRED (run when DB is healthy). If this times out, wait and retry — do not run 034 yet.
--
-- Verify after success:
--   select indexname from pg_indexes
--   where schemaname = 'public' and indexname = 'idx_profiles_pending_customers';

create index if not exists idx_profiles_pending_customers
  on public.profiles (created_at desc)
  where role = 'customer'
    and account_status = 'pending'
    and deleted_at is null;

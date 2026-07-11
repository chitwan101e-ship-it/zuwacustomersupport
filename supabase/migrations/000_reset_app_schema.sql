-- ============================================================
-- DEV / REBUILD: tear down Relay app tables + helpers
-- Run in Supabase SQL Editor ONCE when you see errors like:
--   ERROR: 42P07: relation "businesses" already exists
--   ERROR: type "user_role" already exists
--
-- Does NOT touch auth.users. Deletes app data in public + related helpers.
-- After this, run: schema.sql then migrations 002 → 003 → 004 → 005_suspension_patch_for_existing_db.sql (in order).
-- ============================================================

-- From migration 005
drop table if exists public.moderation_suspension_events cascade;

-- From migration 004 (audit trail; drop before profiles / businesses)
drop table if exists public.deleted_users_audit cascade;

-- From migration 003 (may not exist)
drop table if exists public.notifications cascade;

drop table if exists public.messages cascade;
drop table if exists public.reactions cascade;
drop table if exists public.comments cascade;
drop table if exists public.announcements cascade;
drop table if exists public.conversations cascade;
drop table if exists public.follows cascade;
drop table if exists public.admin_reports cascade;
drop table if exists public.otp_tokens cascade;
drop table if exists public.profiles cascade;
drop table if exists public.businesses cascade;

drop type if exists public.reaction_type cascade;
drop type if exists public.admin_report_status cascade;
drop type if exists public.user_role cascade;
drop type if exists public.business_role cascade;
drop type if exists public.account_status cascade;

drop function if exists public.set_updated_at() cascade;
drop function if exists public.my_profile() cascade;
drop function if exists public.is_business_admin(uuid) cascade;
drop function if exists public.is_business_member(uuid) cascade;
drop function if exists public.is_approved_user() cascade;
drop function if exists public.promote_user_to_business_admin(text, text) cascade;

-- From migration 004 (trigger dropped with messages; function may remain)
drop function if exists public.touch_conversation_on_message() cascade;

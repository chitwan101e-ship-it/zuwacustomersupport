-- Suspension moderation patch for EXISTING databases.
-- Safe, additive, idempotent. Does NOT drop tables/data.
-- Use this if schema.sql was already run before suspension features existed.

-- 1) Add 'suspended' to account_status enum when missing
DO $enum$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'account_status'
      AND e.enumlabel = 'suspended'
  ) THEN
    ALTER TYPE public.account_status ADD VALUE 'suspended';
  END IF;
END
$enum$;

-- 2) Audit log table for suspend/unsuspend actions
CREATE TABLE IF NOT EXISTS public.moderation_suspension_events (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE SET NULL,
  actor_id    uuid NOT NULL,
  action      text NOT NULL CHECK (action IN ('suspend', 'unsuspend')),
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_suspension_profile
  ON public.moderation_suspension_events(profile_id);
CREATE INDEX IF NOT EXISTS idx_moderation_suspension_created
  ON public.moderation_suspension_events(created_at DESC);

COMMENT ON TABLE public.moderation_suspension_events IS
  'Audit log for staff suspend/unsuspend actions. Hidden from regular clients via RLS.';

ALTER TABLE public.moderation_suspension_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "moderation_suspension_events_none" ON public.moderation_suspension_events;
CREATE POLICY "moderation_suspension_events_none"
  ON public.moderation_suspension_events
  FOR ALL
  USING (false);

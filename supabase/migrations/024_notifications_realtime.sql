-- Enable Realtime for in-app notifications (desktop alert fallback).
-- Dashboard: Database → Replication → supabase_realtime should list `notifications`.
-- This migration is safe if the table is already in the publication.

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    return;
  end if;
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

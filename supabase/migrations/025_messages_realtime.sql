-- Enable Realtime for live message INSERT events (staff desktop corner alerts).
-- Dashboard: Database → Replication → supabase_realtime should list `messages`.

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    return;
  end if;
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

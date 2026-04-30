-- Soft-delete metadata on profiles + audit table + keep conversations fresh when customers message

alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.profiles add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists idx_profiles_not_deleted on public.profiles (id) where deleted_at is null;

create table if not exists public.deleted_users_audit (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null,
  auth_user_id uuid not null,
  business_id uuid references public.businesses(id) on delete set null,
  username text,
  reason text,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_deleted_users_audit_profile on public.deleted_users_audit(profile_id);
create index if not exists idx_deleted_users_audit_created on public.deleted_users_audit(created_at desc);

alter table public.deleted_users_audit enable row level security;

drop policy if exists "deleted_users_audit_none" on public.deleted_users_audit;
create policy "deleted_users_audit_none" on public.deleted_users_audit for all using (false);

-- When anyone sends a chat message, bump the parent conversation so inbox ordering stays correct.
create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- Supabase Dashboard → Database → Replication: enable supabase_realtime for `conversations` + `messages`
-- so the staff dashboard live-refreshes (optional; app also polls).

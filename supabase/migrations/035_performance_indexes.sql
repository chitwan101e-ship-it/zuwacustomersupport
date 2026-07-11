-- Faster inbox unread counts (aggregate server-side instead of fetching every unread row).

create or replace function public.inbox_unread_customer_counts(p_conversation_ids uuid[])
returns table(conversation_id uuid, unread_count bigint)
language sql
security definer
set search_path = public
as $$
  select m.conversation_id, count(*)::bigint as unread_count
  from public.messages m
  inner join public.conversations c on c.id = m.conversation_id
  where m.conversation_id = any(p_conversation_ids)
    and m.read is not true
    and m.sender_id = c.customer_id
    and public.is_business_member(c.business_id)
  group by m.conversation_id;
$$;

revoke all on function public.inbox_unread_customer_counts(uuid[]) from public;
grant execute on function public.inbox_unread_customer_counts(uuid[]) to authenticated;

-- Unread message lookups (inbox badge aggregation).
create index if not exists idx_messages_conversation_unread
  on public.messages (conversation_id)
  where read is not true;

-- Platform-wide admin lookup for signup alerts.
create index if not exists idx_profiles_platform_admins
  on public.profiles (role, business_role)
  where deleted_at is null
    and role = 'business'
    and business_role = 'admin';

-- Notification badge counts.
create index if not exists idx_notifications_user_unread_created
  on public.notifications (user_id, created_at desc)
  where read = false;

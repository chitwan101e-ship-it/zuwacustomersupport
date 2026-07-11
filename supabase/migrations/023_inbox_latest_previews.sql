-- Latest message preview per conversation (avoids PostgREST row limits on bulk message queries).

create or replace function public.inbox_latest_previews(p_conversation_ids uuid[])
returns table(conversation_id uuid, body text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select distinct on (m.conversation_id) m.conversation_id, m.body, m.created_at
  from public.messages m
  inner join public.conversations c on c.id = m.conversation_id
  where m.conversation_id = any(p_conversation_ids)
    and public.is_business_member(c.business_id)
  order by m.conversation_id, m.created_at desc;
$$;

revoke all on function public.inbox_latest_previews(uuid[]) from public;
grant execute on function public.inbox_latest_previews(uuid[]) to authenticated;

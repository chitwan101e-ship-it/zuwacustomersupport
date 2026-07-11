-- Per-message read marking for view-based read receipts (staff + customer).

create or replace function public.mark_messages_read_by_ids(p_message_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_message_ids is null or cardinality(p_message_ids) = 0 then
    return 0;
  end if;

  update public.messages m
  set read = true,
      read_at = coalesce(m.read_at, now())
  from public.conversations c
  where m.id = any(p_message_ids)
    and m.conversation_id = c.id
    and m.read is distinct from true
    and (
      (m.sender_id = c.customer_id and public.is_business_member(c.business_id))
      or (m.sender_id is distinct from c.customer_id and auth.uid() = c.customer_id)
    );

  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;

revoke all on function public.mark_messages_read_by_ids(uuid[]) from public;
grant execute on function public.mark_messages_read_by_ids(uuid[]) to authenticated;

-- Reliable "mark customer messages read" for staff (bypasses PostgREST PATCH filter quirks).
-- Call from the app via: rpc('mark_customer_messages_read_for_staff', { p_conversation_id: '<uuid>' })

create or replace function public.mark_customer_messages_read_for_staff(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_business_id uuid;
  n int;
begin
  select c.customer_id, c.business_id
  into v_customer_id, v_business_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_customer_id is null or v_business_id is null then
    return 0;
  end if;

  if not public.is_business_member(v_business_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.messages m
  set read = true
  where m.conversation_id = p_conversation_id
    and m.sender_id = v_customer_id
    and m.read is distinct from true;

  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;

revoke all on function public.mark_customer_messages_read_for_staff(uuid) from public;
grant execute on function public.mark_customer_messages_read_for_staff(uuid) to authenticated;

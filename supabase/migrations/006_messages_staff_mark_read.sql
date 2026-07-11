-- Staff inbox: allow business members to update messages (mark customer messages read).
-- Also backfill customer-authored messages as read so only messages created after this migration default to unread for badges.

drop policy if exists "msg_update_business_member" on public.messages;

create policy "msg_update_business_member"
  on public.messages for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and public.is_business_member(c.business_id)
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and public.is_business_member(c.business_id)
    )
  );

-- Historical customer messages: treat as already seen (read = true) so badges reflect new traffic only
update public.messages m
set read = true
from public.conversations c
where m.conversation_id = c.id
  and m.sender_id = c.customer_id;

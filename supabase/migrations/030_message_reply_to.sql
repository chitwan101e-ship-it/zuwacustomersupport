-- Reply to a specific message in a support thread (Messenger-style quoted reply).

alter table public.messages
  add column if not exists reply_to_message_id uuid references public.messages (id) on delete set null;

create index if not exists idx_messages_reply_to on public.messages (reply_to_message_id)
  where reply_to_message_id is not null;

create or replace function public.messages_validate_reply_to()
returns trigger
language plpgsql
as $$
begin
  if new.reply_to_message_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.messages parent
    where parent.id = new.reply_to_message_id
      and parent.conversation_id = new.conversation_id
  ) then
    raise exception 'reply target must belong to the same conversation';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_validate_reply_to on public.messages;
create trigger messages_validate_reply_to
  before insert or update of reply_to_message_id, conversation_id on public.messages
  for each row
  execute function public.messages_validate_reply_to();

-- Link notifications to support threads and create alerts on new messages.
-- Staff: one row per business member when a customer sends a message.
-- Customer: one row when staff replies.
-- App marks these read when the user opens the thread (see markConversationNotificationsRead).

alter table public.notifications add column if not exists conversation_id uuid references public.conversations(id) on delete set null;

create index if not exists idx_notifications_user_conversation_unread
  on public.notifications(user_id, conversation_id)
  where read = false;

drop trigger if exists messages_notify_staff_after_insert on public.messages;
drop trigger if exists messages_notify_customer_after_insert on public.messages;
drop function if exists public.notify_staff_on_customer_message();
drop function if exists public.notify_customer_on_staff_reply();

create or replace function public.notify_staff_on_customer_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  staff record;
  preview text;
begin
  select * into c from public.conversations where id = new.conversation_id;
  if c.id is null then
    return new;
  end if;
  if new.sender_id <> c.customer_id then
    return new;
  end if;

  preview := left(trim(new.body), 160);
  if preview is null or preview = '' then
    preview := '📷 Message';
  end if;

  for staff in
    select id
    from public.profiles
    where business_id = c.business_id
      and role = 'business'
      and deleted_at is null
  loop
    insert into public.notifications (user_id, business_id, type, title, body, link, conversation_id)
    values (
      staff.id,
      c.business_id,
      'support_message',
      'New customer message',
      preview,
      '/dashboard',
      c.id
    );
  end loop;

  return new;
end;
$$;

create or replace function public.notify_customer_on_staff_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  preview text;
begin
  select * into c from public.conversations where id = new.conversation_id;
  if c.id is null then
    return new;
  end if;
  if new.sender_id = c.customer_id then
    return new;
  end if;

  preview := left(trim(new.body), 160);
  if preview is null or preview = '' then
    preview := '📷 Reply';
  end if;

  insert into public.notifications (user_id, business_id, type, title, body, link, conversation_id)
  values (
    c.customer_id,
    c.business_id,
    'support_reply',
    'New reply from the team',
    preview,
    '/feed',
    c.id
  );

  return new;
end;
$$;

create trigger messages_notify_staff_after_insert
  after insert on public.messages
  for each row execute function public.notify_staff_on_customer_message();

create trigger messages_notify_customer_after_insert
  after insert on public.messages
  for each row execute function public.notify_customer_on_staff_reply();

-- Safer UPDATE policy: recipient can only keep rows tied to their user_id when toggling read.
drop policy if exists "notifications_own_update" on public.notifications;
create policy "notifications_own_update"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

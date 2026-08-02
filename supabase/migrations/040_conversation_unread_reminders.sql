-- Unread staff→customer email reminder ladder (15m / 3h / 24h).
-- One active streak per conversation; does not restart on extra staff replies while unread.

create table if not exists public.conversation_unread_reminders (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  streak_started_at timestamptz not null default now(),
  emails_sent int not null default 0 check (emails_sent >= 0 and emails_sent <= 3),
  last_email_sent_at timestamptz,
  last_preview text,
  status text not null default 'active'
    check (status in ('active', 'cancelled', 'completed')),
  updated_at timestamptz not null default now()
);

create index if not exists idx_unread_reminders_due
  on public.conversation_unread_reminders (status, emails_sent, streak_started_at)
  where status = 'active';

alter table public.conversation_unread_reminders enable row level security;

-- Staff can read reminder state for their business (optional debugging); writes via service role / SECURITY DEFINER.
drop policy if exists conversation_unread_reminders_staff_select on public.conversation_unread_reminders;
create policy conversation_unread_reminders_staff_select
  on public.conversation_unread_reminders
  for select
  using (public.is_business_member(business_id));

/** Start a reminder streak when staff send a message. Does not reset an already-active streak. */
create or replace function public.ensure_conversation_unread_reminder(
  p_conversation_id uuid,
  p_preview text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_customer_id uuid;
  v_status text;
begin
  select c.business_id, c.customer_id
    into v_business_id, v_customer_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_business_id is null or v_customer_id is null then
    return;
  end if;

  select r.status into v_status
  from public.conversation_unread_reminders r
  where r.conversation_id = p_conversation_id;

  if v_status = 'active' then
    update public.conversation_unread_reminders
    set
      last_preview = coalesce(nullif(trim(p_preview), ''), last_preview),
      updated_at = now()
    where conversation_id = p_conversation_id;
    return;
  end if;

  insert into public.conversation_unread_reminders (
    conversation_id,
    business_id,
    customer_id,
    streak_started_at,
    emails_sent,
    last_email_sent_at,
    last_preview,
    status,
    updated_at
  )
  values (
    p_conversation_id,
    v_business_id,
    v_customer_id,
    now(),
    0,
    null,
    nullif(trim(p_preview), ''),
    'active',
    now()
  )
  on conflict (conversation_id) do update
  set
    business_id = excluded.business_id,
    customer_id = excluded.customer_id,
    streak_started_at = now(),
    emails_sent = 0,
    last_email_sent_at = null,
    last_preview = coalesce(excluded.last_preview, public.conversation_unread_reminders.last_preview),
    status = 'active',
    updated_at = now();
end;
$$;

/** Cancel active reminder when the customer has no remaining unread staff messages. */
create or replace function public.cancel_conversation_unread_reminder_if_clear(
  p_conversation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_unread int;
begin
  select c.customer_id into v_customer_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_customer_id is null then
    return false;
  end if;

  select count(*)::int into v_unread
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id is distinct from v_customer_id
    and m.read is distinct from true;

  if coalesce(v_unread, 0) > 0 then
    return false;
  end if;

  update public.conversation_unread_reminders
  set status = 'cancelled', updated_at = now()
  where conversation_id = p_conversation_id
    and status = 'active';

  return found;
end;
$$;

-- After customer (or staff) marks messages read, clear reminder if thread is fully caught up.
create or replace function public.mark_messages_read_by_ids(p_message_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  cid uuid;
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

  for cid in
    select distinct m.conversation_id
    from public.messages m
    where m.id = any(p_message_ids)
  loop
    perform public.cancel_conversation_unread_reminder_if_clear(cid);
  end loop;

  return coalesce(n, 0);
end;
$$;

revoke all on function public.ensure_conversation_unread_reminder(uuid, text) from public;
revoke all on function public.cancel_conversation_unread_reminder_if_clear(uuid) from public;
grant execute on function public.ensure_conversation_unread_reminder(uuid, text) to service_role;
grant execute on function public.cancel_conversation_unread_reminder_if_clear(uuid) to service_role;
grant execute on function public.cancel_conversation_unread_reminder_if_clear(uuid) to authenticated;

-- Whole-thread customer mark-read also clears the reminder ladder.
create or replace function public.mark_staff_messages_read_for_customer(p_conversation_id uuid)
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

  if v_customer_id is null or auth.uid() is distinct from v_customer_id then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.messages m
  set read = true,
      read_at = now()
  where m.conversation_id = p_conversation_id
    and m.sender_id is distinct from v_customer_id
    and m.read is distinct from true;

  get diagnostics n = row_count;
  perform public.cancel_conversation_unread_reminder_if_clear(p_conversation_id);
  return coalesce(n, 0);
end;
$$;

revoke all on function public.mark_staff_messages_read_for_customer(uuid) from public;
grant execute on function public.mark_staff_messages_read_for_customer(uuid) to authenticated;

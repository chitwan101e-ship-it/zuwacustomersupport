-- Staff notification title: "{First name} message" instead of generic "New customer message".

create or replace function public.notify_staff_on_customer_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  staff record;
  customer record;
  preview text;
  popup_title text;
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

  select first_name, username into customer
  from public.profiles
  where id = c.customer_id;

  popup_title := coalesce(
    nullif(trim(customer.first_name), ''),
    nullif(trim(customer.username), ''),
    'Customer'
  ) || ' message';

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
      popup_title,
      preview,
      '/dashboard',
      c.id
    );
  end loop;

  return new;
end;
$$;

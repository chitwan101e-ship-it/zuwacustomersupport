-- Notify every approved customer linked to a post's business in one statement.
-- Publishing was waiting on hundreds of client inserts, so the composer stayed on
-- "Publishing…" after the post was already on the feed.

create or replace function public.notify_approved_customers_of_announcement(
  p_announcement_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_title text;
  v_body text;
  v_preview text;
  v_link text;
  n int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select a.business_id, a.title, coalesce(a.body, '')
    into v_business_id, v_title, v_body
  from public.announcements a
  where a.id = p_announcement_id
    and a.deleted_at is null;

  if v_business_id is null then
    raise exception 'announcement not found' using errcode = 'P0002';
  end if;

  v_preview := v_body;
  if char_length(v_preview) > 120 then
    v_preview := left(v_preview, 117) || '…';
  end if;

  v_link := '/feed?post=' || p_announcement_id::text;

  insert into public.notifications (user_id, business_id, type, title, body, link)
  select p.id,
         v_business_id,
         'announcement',
         'New post: ' || coalesce(nullif(btrim(v_title), ''), 'Update'),
         v_preview,
         v_link
  from public.profiles p
  where p.role = 'customer'
    and p.account_status = 'approved'
    and p.deleted_at is null
    and (
      exists (
        select 1
        from public.conversations c
        where c.business_id = v_business_id
          and c.customer_id = p.id
      )
      or exists (
        select 1
        from public.follows f
        where f.business_id = v_business_id
          and f.user_id = p.id
      )
    )
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = p.id
        and n.type = 'announcement'
        and n.link = v_link
    );

  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;

revoke all on function public.notify_approved_customers_of_announcement(uuid) from public;
revoke all on function public.notify_approved_customers_of_announcement(uuid) from anon;
revoke all on function public.notify_approved_customers_of_announcement(uuid) from authenticated;
grant execute on function public.notify_approved_customers_of_announcement(uuid) to service_role;

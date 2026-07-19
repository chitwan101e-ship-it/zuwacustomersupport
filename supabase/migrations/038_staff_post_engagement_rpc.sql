-- Staff dashboard was showing 0 likes/comments while the customer feed showed real counts.
-- Direct selects on reactions/comments can fail silently under RLS/embed edge cases.
-- These SECURITY DEFINER RPCs return engagement for a business the caller belongs to.

create or replace function public.staff_post_reaction_rows(p_business_id uuid)
returns table (announcement_id uuid, user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'not authorized';
  end if;

  return query
  select r.announcement_id, r.user_id
  from public.reactions r
  inner join public.announcements a on a.id = r.announcement_id
  where a.business_id = p_business_id
    and a.deleted_at is null
    and r.reaction = 'like';
end;
$$;

create or replace function public.staff_post_comment_rows(p_business_id uuid)
returns table (
  id uuid,
  announcement_id uuid,
  user_id uuid,
  parent_comment_id uuid,
  body text,
  created_at timestamptz,
  hidden_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'not authorized';
  end if;

  return query
  select c.id, c.announcement_id, c.user_id, c.parent_comment_id, c.body, c.created_at, c.hidden_at
  from public.comments c
  inner join public.announcements a on a.id = c.announcement_id
  where a.business_id = p_business_id
    and a.deleted_at is null
    and c.deleted_at is null;
end;
$$;

revoke all on function public.staff_post_reaction_rows(uuid) from public;
revoke all on function public.staff_post_comment_rows(uuid) from public;
grant execute on function public.staff_post_reaction_rows(uuid) to authenticated;

grant execute on function public.staff_post_comment_rows(uuid) to authenticated;

-- Ensure anyone authenticated can read reaction rows (customer feed + staff fallback).
drop policy if exists "reactions_read" on public.reactions;
create policy "reactions_read" on public.reactions for select using (true);

grant select on table public.reactions to authenticated, anon;
grant select on table public.comments to authenticated, anon;

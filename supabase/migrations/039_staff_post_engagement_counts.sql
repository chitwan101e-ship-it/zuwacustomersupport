-- Fix truncated like/comment counts (PostgREST default max 1000 rows).
-- Staff RPCs in 038 returned EVERY reaction/comment for the business in one shot,
-- so viral older posts filled the cap and newer posts showed 0 likes/comments.
-- Customer feed had the same cap when selecting all engagement for visible posts.
-- Aggregated counts return one row per announcement (well under the cap).

create or replace function public.staff_post_engagement_counts(
  p_business_id uuid,
  p_announcement_ids uuid[]
)
returns table (
  announcement_id uuid,
  like_count bigint,
  comment_count bigint
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

  if p_announcement_ids is null or cardinality(p_announcement_ids) = 0 then
    return;
  end if;

  return query
  select
    a.id as announcement_id,
    (
      select count(*)::bigint
      from public.reactions r
      where r.announcement_id = a.id
        and r.reaction = 'like'
    ) as like_count,
    (
      select count(*)::bigint
      from public.comments c
      where c.announcement_id = a.id
        and c.deleted_at is null
    ) as comment_count
  from public.announcements a
  where a.business_id = p_business_id
    and a.deleted_at is null
    and a.id = any (p_announcement_ids);
end;
$$;

revoke all on function public.staff_post_engagement_counts(uuid, uuid[]) from public;
grant execute on function public.staff_post_engagement_counts(uuid, uuid[]) to authenticated;

-- Scope row RPCs to the announcements being viewed (still paginate in the client).
drop function if exists public.staff_post_reaction_rows(uuid);
drop function if exists public.staff_post_comment_rows(uuid);

create or replace function public.staff_post_reaction_rows(
  p_business_id uuid,
  p_announcement_ids uuid[]
)
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

  if p_announcement_ids is null or cardinality(p_announcement_ids) = 0 then
    return;
  end if;

  return query
  select r.announcement_id, r.user_id
  from public.reactions r
  inner join public.announcements a on a.id = r.announcement_id
  where a.business_id = p_business_id
    and a.deleted_at is null
    and r.reaction = 'like'
    and r.announcement_id = any (p_announcement_ids);
end;
$$;

create or replace function public.staff_post_comment_rows(
  p_business_id uuid,
  p_announcement_ids uuid[]
)
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

  if p_announcement_ids is null or cardinality(p_announcement_ids) = 0 then
    return;
  end if;

  return query
  select c.id, c.announcement_id, c.user_id, c.parent_comment_id, c.body, c.created_at, c.hidden_at
  from public.comments c
  inner join public.announcements a on a.id = c.announcement_id
  where a.business_id = p_business_id
    and a.deleted_at is null
    and c.deleted_at is null
    and c.announcement_id = any (p_announcement_ids)
  order by c.created_at asc;
end;
$$;

revoke all on function public.staff_post_reaction_rows(uuid, uuid[]) from public;
revoke all on function public.staff_post_comment_rows(uuid, uuid[]) from public;
grant execute on function public.staff_post_reaction_rows(uuid, uuid[]) to authenticated;
grant execute on function public.staff_post_comment_rows(uuid, uuid[]) to authenticated;

-- Threaded replies on announcement comments (Facebook-style).
-- Run in Supabase SQL Editor on existing databases after earlier migrations.

alter table public.comments
  add column if not exists parent_comment_id uuid references public.comments (id) on delete cascade;

create index if not exists idx_comments_parent on public.comments (parent_comment_id)
  where parent_comment_id is not null;

create or replace function public.comments_validate_parent()
returns trigger
language plpgsql
as $$
begin
  if new.parent_comment_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.comments p
    where p.id = new.parent_comment_id
      and p.announcement_id = new.announcement_id
  ) then
    raise exception 'parent comment must belong to the same announcement';
  end if;
  return new;
end;
$$;

drop trigger if exists comments_validate_parent on public.comments;
create trigger comments_validate_parent
  before insert or update of parent_comment_id, announcement_id on public.comments
  for each row
  execute function public.comments_validate_parent();

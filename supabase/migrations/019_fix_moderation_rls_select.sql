-- Fix 403 on soft-delete/hide updates: staff must be able to SELECT rows they moderate
-- (PostgREST returns updated rows; old announce_read blocked deleted_at IS NOT NULL).

drop policy if exists "announce_read" on public.announcements;
create policy "announce_read"
  on public.announcements for select
  using (
    public.is_business_member(business_id)
    or (deleted_at is null and hidden_at is null)
  );

drop policy if exists "comments_read" on public.comments;
create policy "comments_read"
  on public.comments for select
  using (
    exists (
      select 1
      from public.announcements a
      where a.id = comments.announcement_id
        and public.is_business_member(a.business_id)
    )
    or (
      deleted_at is null
      and (hidden_at is null or user_id = auth.uid())
    )
  );

-- Ensure business members (not only admins) can update announcements.
drop policy if exists "announce_update" on public.announcements;
create policy "announce_update"
  on public.announcements for update
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

drop policy if exists "announce_insert" on public.announcements;
create policy "announce_insert"
  on public.announcements for insert
  with check (public.is_business_member(business_id));

drop policy if exists "announce_delete" on public.announcements;
create policy "announce_delete"
  on public.announcements for delete
  using (public.is_business_member(business_id));

-- Soft moderation for announcements (posts) and comments: hide + soft-delete.

alter table public.announcements
  add column if not exists hidden_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.comments
  add column if not exists hidden_at timestamptz,
  add column if not exists deleted_at timestamptz;

create index if not exists idx_announcements_feed_visible
  on public.announcements (business_id, created_at desc)
  where deleted_at is null and hidden_at is null;

create index if not exists idx_comments_feed_visible
  on public.comments (announcement_id, created_at)
  where deleted_at is null and hidden_at is null;

-- Announcements: public feed sees only visible posts; staff see hidden on dashboard.
drop policy if exists "announce_read" on public.announcements;
create policy "announce_read"
  on public.announcements for select
  using (
    public.is_business_member(business_id)
    or (deleted_at is null and hidden_at is null)
  );

-- Comments: visible to everyone unless hidden/deleted; authors and staff see hidden.
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

-- Staff can update/delete any comment on their business announcements.
drop policy if exists "comments_staff_update" on public.comments;
create policy "comments_staff_update"
  on public.comments for update
  using (
    exists (
      select 1
      from public.announcements a
      where a.id = comments.announcement_id
        and public.is_business_member(a.business_id)
    )
  );

drop policy if exists "comments_staff_delete" on public.comments;
create policy "comments_staff_delete"
  on public.comments for delete
  using (
    exists (
      select 1
      from public.announcements a
      where a.id = comments.announcement_id
        and public.is_business_member(a.business_id)
    )
  );

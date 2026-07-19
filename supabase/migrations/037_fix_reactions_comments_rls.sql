-- Fix likes/comments failing with empty PostgREST errors (RLS / missing grants).
-- `FOR ALL USING (...)` without explicit WITH CHECK + missing GRANTs often blocks INSERT.

grant select, insert, update, delete on table public.reactions to authenticated;
grant select on table public.reactions to anon;

grant select, insert, update, delete on table public.comments to authenticated;
grant select on table public.comments to anon;

drop policy if exists "reactions_own" on public.reactions;
drop policy if exists "reactions_insert_own" on public.reactions;
drop policy if exists "reactions_update_own" on public.reactions;
drop policy if exists "reactions_delete_own" on public.reactions;

create policy "reactions_insert_own"
  on public.reactions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "reactions_update_own"
  on public.reactions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "reactions_delete_own"
  on public.reactions for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "comments_own" on public.comments;
drop policy if exists "comments_insert_own" on public.comments;
drop policy if exists "comments_update_own" on public.comments;
drop policy if exists "comments_delete_own" on public.comments;

create policy "comments_insert_own"
  on public.comments for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "comments_update_own"
  on public.comments for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "comments_delete_own"
  on public.comments for delete
  to authenticated
  using (user_id = auth.uid());

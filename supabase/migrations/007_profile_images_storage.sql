-- Adds profile photo storage support for both customer and business users.

alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', true)
on conflict (id) do nothing;

drop policy if exists "profile_images_select" on storage.objects;
drop policy if exists "profile_images_insert" on storage.objects;
drop policy if exists "profile_images_update_own" on storage.objects;
drop policy if exists "profile_images_delete_own" on storage.objects;

create policy "profile_images_select"
  on storage.objects for select
  using (bucket_id = 'profile-images');

create policy "profile_images_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "profile_images_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "profile_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

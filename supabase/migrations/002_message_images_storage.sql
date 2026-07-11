-- Run this in Supabase SQL Editor after the main schema.sql
-- Adds optional image attachments on support messages + a public storage bucket.

alter table public.messages add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('message-images', 'message-images', true)
on conflict (id) do nothing;

drop policy if exists "message_images_select" on storage.objects;
drop policy if exists "message_images_insert" on storage.objects;
drop policy if exists "message_images_update_own" on storage.objects;
drop policy if exists "message_images_delete_own" on storage.objects;

create policy "message_images_select"
  on storage.objects for select
  using (bucket_id = 'message-images');

create policy "message_images_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "message_images_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "message_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Run this in Supabase → SQL Editor after the main schema.sql
-- Adds optional image attachments on support messages + a public storage bucket.

alter table public.messages add column if not exists image_url text;

-- Public bucket so chat bubbles can use stable URLs (tighten to private + signed URLs later if needed)
insert into storage.buckets (id, name, public)
values ('message-images', 'message-images', true)
on conflict (id) do nothing;

drop policy if exists "message_images_select" on storage.objects;
drop policy if exists "message_images_insert" on storage.objects;
drop policy if exists "message_images_update_own" on storage.objects;
drop policy if exists "message_images_delete_own" on storage.objects;

-- Authenticated users can upload; objects must live under their user-id folder (first path segment)
create policy "message_images_select"
  on storage.objects for select
  using (bucket_id = 'message-images');

create policy "message_images_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "message_images_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "message_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

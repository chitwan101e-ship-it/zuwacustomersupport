-- Customer notifications (in-app inbox + unread badge)

create table if not exists public.notifications (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  type        text not null default 'announcement',
  title       text not null,
  body        text not null,
  link        text,
  read        boolean not null default false,
  created_at  timestamptz default now()
);

create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_user_unread
  on public.notifications(user_id, read);

alter table public.notifications enable row level security;

drop policy if exists "notifications_own_read" on public.notifications;
drop policy if exists "notifications_own_update" on public.notifications;
drop policy if exists "notifications_own_delete" on public.notifications;
drop policy if exists "notifications_insert" on public.notifications;

create policy "notifications_own_read"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "notifications_own_update"
  on public.notifications for update
  using (user_id = auth.uid());

create policy "notifications_own_delete"
  on public.notifications for delete
  using (user_id = auth.uid());

-- Allow users to create their own notifications (for local/manual tests)
-- and business members to create notifications tied to their business.
create policy "notifications_insert"
  on public.notifications for insert
  with check (
    user_id = auth.uid()
    or (
      business_id is not null
      and public.is_business_member(business_id)
    )
  );


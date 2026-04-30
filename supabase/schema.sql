-- ============================================================
-- JBCOMS â€” Full Supabase Schema
-- Fresh database bootstrap only.
-- Run this ONLY on a brand-new database.
--
-- If your database already exists, do NOT run this file again unless you
-- intentionally reset: run `supabase/migrations/000_reset_app_schema.sql` first.
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 1. BUSINESSES
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.businesses (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  slug          text not null unique,          -- subdomain: slug.jbcoms.com
  description   text,
  logo_url      text,
  created_at    timestamptz default now()
);

-- Index for fast subdomain lookups
create index idx_businesses_slug on public.businesses(slug);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 2. PROFILES  (extends Supabase auth.users 1-to-1)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create type public.user_role     as enum ('customer', 'business');
create type public.business_role as enum ('admin', 'support');
create type public.account_status as enum ('pending', 'approved', 'rejected', 'blocked', 'suspended');

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique,
  first_name    text not null,
  last_name     text not null,
  phone         text,
  avatar_url    text,
  role          public.user_role not null default 'customer',
  -- business-specific (null for customers)
  business_id   uuid references public.businesses(id) on delete set null,
  business_role public.business_role,
  account_status public.account_status not null default 'pending',
  email_verified boolean default false,
  created_at    timestamptz default now(),
  -- constraints
  constraint business_role_requires_business
    check (
      (role = 'business' and business_id is not null and business_role is not null)
      or role = 'customer'
    )
);

create index idx_profiles_business on public.profiles(business_id);
create index idx_profiles_username  on public.profiles(username);
create index idx_profiles_status    on public.profiles(account_status);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 3. OTP TOKENS  (for email verification via Resend)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.otp_tokens (
  id         uuid primary key default uuid_generate_v4(),
  email      text not null,
  token      text not null,                  -- 6-digit code (hashed)
  expires_at timestamptz not null,
  used       boolean default false,
  created_at timestamptz default now()
);

create index idx_otp_email on public.otp_tokens(email);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 4. ANNOUNCEMENTS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.announcements (
  id          uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  body        text not null,
  image_url   text,
  pinned      boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index idx_announcements_business on public.announcements(business_id);
create index idx_announcements_created  on public.announcements(created_at desc);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 5. REACTIONS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create type public.reaction_type as enum ('like', 'helpful', 'love', 'question');

create table public.reactions (
  id              uuid primary key default uuid_generate_v4(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  reaction        public.reaction_type not null default 'like',
  created_at      timestamptz default now(),
  unique (announcement_id, user_id)
);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 6. COMMENTS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.comments (
  id              uuid primary key default uuid_generate_v4(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  body            text not null,
  created_at      timestamptz default now()
);

create index idx_comments_announcement on public.comments(announcement_id);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 7. CONVERSATIONS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.conversations (
  id            uuid primary key default uuid_generate_v4(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  customer_id   uuid not null references public.profiles(id) on delete cascade,
  assigned_to   uuid references public.profiles(id) on delete set null,
  status        text not null default 'open',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (business_id, customer_id)
);

create index idx_conversations_business  on public.conversations(business_id);
create index idx_conversations_customer  on public.conversations(customer_id);
create index idx_conversations_assigned  on public.conversations(assigned_to);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 8. MESSAGES
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.messages (
  id              uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null,
  read            boolean default false,
  created_at      timestamptz default now()
);

create index idx_messages_conversation on public.messages(conversation_id);
create index idx_messages_created      on public.messages(created_at asc);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 9. FOLLOWS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create table public.follows (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (user_id, business_id)
);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 10. ADMIN REPORTS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create type public.admin_report_status as enum ('new', 'in_review', 'resolved');

create table public.admin_reports (
  id            uuid primary key default uuid_generate_v4(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  reporter_id   uuid references public.profiles(id) on delete set null,
  reporter_name text not null,
  category      text not null,
  details       text not null,
  status        public.admin_report_status not null default 'new',
  assigned_to   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index idx_admin_reports_business on public.admin_reports(business_id);
create index idx_admin_reports_status on public.admin_reports(status);

-- Moderation: suspend / unsuspend audit (matches migration 005)
create table public.moderation_suspension_events (
  id            uuid primary key default uuid_generate_v4(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  business_id   uuid not null references public.businesses(id) on delete set null,
  actor_id      uuid not null,
  action        text not null check (action in ('suspend', 'unsuspend')),
  reason        text,
  created_at    timestamptz not null default now()
);

create index idx_moderation_suspension_profile on public.moderation_suspension_events (profile_id);
create index idx_moderation_suspension_created on public.moderation_suspension_events (created_at desc);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 11. HELPERS + RLS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create or replace function public.my_profile()
returns public.profiles
language sql security definer stable
as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.is_business_admin(bid uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and business_id = bid
      and business_role = 'admin'
  );
$$;

create or replace function public.is_business_member(bid uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and business_id = bid
      and role = 'business'
  );
$$;

create or replace function public.is_approved_user()
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and account_status = 'approved'
  );
$$;

create or replace function public.promote_user_to_business_admin(
  user_email text,
  target_business_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  target_business_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only service role can call promote_user_to_business_admin';
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = lower(user_email)
  limit 1;

  if target_user_id is null then
    raise exception 'User not found for email: %', user_email;
  end if;

  select id into target_business_id
  from public.businesses
  where slug = target_business_slug
  limit 1;

  if target_business_id is null then
    raise exception 'Business not found for slug: %', target_business_slug;
  end if;

  update public.profiles
  set role = 'business',
      business_id = target_business_id,
      business_role = 'admin',
      account_status = 'approved'
  where id = target_user_id;

  if not found then
    raise exception 'Profile row not found for user: %', user_email;
  end if;

  return target_user_id;
end;
$$;

alter table public.businesses     enable row level security;
alter table public.profiles       enable row level security;
alter table public.otp_tokens     enable row level security;
alter table public.announcements  enable row level security;
alter table public.reactions      enable row level security;
alter table public.comments       enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.follows        enable row level security;
alter table public.admin_reports  enable row level security;
alter table public.moderation_suspension_events enable row level security;

create policy "businesses_read"   on public.businesses for select using (true);
create policy "businesses_insert" on public.businesses for insert with check (false);

create policy "profiles_own"      on public.profiles for all    using (id = auth.uid());
create policy "profiles_read"     on public.profiles for select using (true);

create policy "otp_none"          on public.otp_tokens for all  using (false);

create policy "announce_read"     on public.announcements for select using (true);
create policy "announce_insert"   on public.announcements for insert with check (public.is_business_admin(business_id));
create policy "announce_update"   on public.announcements for update using (public.is_business_admin(business_id));
create policy "announce_delete"   on public.announcements for delete using (public.is_business_admin(business_id));

create policy "reactions_read"    on public.reactions for select using (true);
create policy "reactions_own"     on public.reactions for all    using (user_id = auth.uid());

create policy "comments_read"     on public.comments for select using (true);
create policy "comments_own"      on public.comments for all    using (user_id = auth.uid());

create policy "convo_customer"    on public.conversations for select using (customer_id = auth.uid());
create policy "convo_business"    on public.conversations for select using (public.is_business_member(business_id));
create policy "convo_insert"      on public.conversations for insert with check (customer_id = auth.uid());
create policy "convo_update_biz"  on public.conversations for update using (public.is_business_member(business_id));

create policy "msg_read"          on public.messages for select
using (
  sender_id = auth.uid()
  or exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.customer_id = auth.uid() or public.is_business_member(c.business_id))
  )
);
create policy "msg_insert"        on public.messages for insert with check (sender_id = auth.uid());

create policy "msg_update_business_member"
  on public.messages for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and public.is_business_member(c.business_id)
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and public.is_business_member(c.business_id)
    )
  );

create policy "follows_read"      on public.follows for select using (true);
create policy "follows_own"       on public.follows for all    using (user_id = auth.uid());

create policy "admin_reports_select" on public.admin_reports for select
  using (public.is_business_member(business_id) or reporter_id = auth.uid());
create policy "admin_reports_insert" on public.admin_reports for insert
  with check (reporter_id = auth.uid());
create policy "admin_reports_update" on public.admin_reports for update
  using (public.is_business_member(business_id));

create policy "moderation_suspension_events_none"
  on public.moderation_suspension_events for all using (false);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 12. AUTO-UPDATE updated_at
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_announcements_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

create trigger set_conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create trigger set_admin_reports_updated_at
  before update on public.admin_reports
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 13. REALTIME (manual, optional)
-- ────────────────────────────────────────────────────────────
-- Supabase Dashboard → Database → Replication:
-- enable for: messages, conversations, announcements (if you want live updates).

-- ────────────────────────────────────────────────────────────
-- TROUBLESHOOTING: relation already exists
-- ────────────────────────────────────────────────────────────
-- Your database still has tables from an earlier run. In SQL Editor, run once:
--   supabase/migrations/000_reset_app_schema.sql
-- Then run this schema again, then 002_message_images_storage.sql, 003_notifications.sql,
-- 004_deleted_users_touch_inbox.sql, 005_suspension_patch_for_existing_db.sql, and 006_messages_staff_mark_read.sql as needed.

-- ============================================================
-- JBCOMS — Full Supabase Schema
-- Run this in your Supabase SQL editor (Database > SQL Editor)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ────────────────────────────────────────────────────────────
-- 1. BUSINESSES
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 2. PROFILES  (extends Supabase auth.users 1-to-1)
-- ────────────────────────────────────────────────────────────
create type public.user_role    as enum ('customer', 'business');
create type public.business_role as enum ('admin', 'support');

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

-- ────────────────────────────────────────────────────────────
-- 3. OTP TOKENS  (for email verification via Resend)
-- ────────────────────────────────────────────────────────────
create table public.otp_tokens (
  id         uuid primary key default uuid_generate_v4(),
  email      text not null,
  token      text not null,                  -- 6-digit code (hashed)
  expires_at timestamptz not null,
  used       boolean default false,
  purpose    text not null default 'signup' check (purpose in ('signup', 'password_reset')),
  created_at timestamptz default now()
);

create index idx_otp_email on public.otp_tokens(email);
create index idx_otp_tokens_email_purpose_active on public.otp_tokens (email, purpose) where used = false;

create or replace function public.relay_auth_user_id_for_email(p_email text)
returns uuid
language sql
security definer
set search_path = auth
stable
as $$
  select u.id
  from auth.users u
  where lower(trim(u.email::text)) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.relay_auth_user_id_for_email(text) from public;
grant execute on function public.relay_auth_user_id_for_email(text) to service_role;

-- Auto-delete used/expired tokens after 1 hour (optional cron approach)
-- Alternatively, use Supabase's pg_cron extension.

-- ────────────────────────────────────────────────────────────
-- 4. ANNOUNCEMENTS
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 5. REACTIONS  (like, helpful, etc.)
-- ────────────────────────────────────────────────────────────
create type public.reaction_type as enum ('like', 'helpful', 'love', 'question');

create table public.reactions (
  id              uuid primary key default uuid_generate_v4(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  reaction        public.reaction_type not null default 'like',
  created_at      timestamptz default now(),
  unique (announcement_id, user_id)             -- one reaction per user per post
);

-- ────────────────────────────────────────────────────────────
-- 6. COMMENTS on announcements
-- ────────────────────────────────────────────────────────────
create table public.comments (
  id              uuid primary key default uuid_generate_v4(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  body            text not null,
  created_at      timestamptz default now()
);

create index idx_comments_announcement on public.comments(announcement_id);

-- ────────────────────────────────────────────────────────────
-- 7. CONVERSATIONS  (customer ↔ business thread)
-- ────────────────────────────────────────────────────────────
create table public.conversations (
  id            uuid primary key default uuid_generate_v4(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  customer_id   uuid not null references public.profiles(id) on delete cascade,
  assigned_to   uuid references public.profiles(id) on delete set null,  -- support agent
  status        text not null default 'open',   -- open | closed | pending
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (business_id, customer_id)             -- one thread per customer per business
);

create index idx_conversations_business  on public.conversations(business_id);
create index idx_conversations_customer  on public.conversations(customer_id);
create index idx_conversations_assigned  on public.conversations(assigned_to);

-- ────────────────────────────────────────────────────────────
-- 8. MESSAGES within a conversation
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 9. BUSINESS FOLLOWERS (customers who follow a business)
-- ────────────────────────────────────────────────────────────
create table public.follows (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (user_id, business_id)
);

-- ────────────────────────────────────────────────────────────
-- 10. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

-- Helper: get current user's profile row
create or replace function public.my_profile()
returns public.profiles
language sql security definer stable
as $$
  select * from public.profiles where id = auth.uid();
$$;

-- Helper: is current user admin of a business?
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

-- Helper: is current user a member (admin or support) of a business?
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

create or replace function public.is_business_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'business'
      and business_id is not null
  );
$$;

-- Enable RLS on all tables
alter table public.businesses     enable row level security;
alter table public.profiles       enable row level security;
alter table public.otp_tokens     enable row level security;
alter table public.announcements  enable row level security;
alter table public.reactions      enable row level security;
alter table public.comments       enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.follows        enable row level security;

-- BUSINESSES: anyone can read, service role only for insert
create policy "businesses_read"   on public.businesses for select using (true);
create policy "businesses_insert" on public.businesses for insert with check (false); -- via service role API only

-- PROFILES: least-privilege RLS (see migration 020_harden_profiles_rls.sql)
create policy "profiles_select_own" on public.profiles for select using (id = auth.uid());
create policy "profiles_select_business_team" on public.profiles for select
  using (role = 'business' and business_id is not null and public.is_business_member(business_id));
create policy "profiles_select_business_customers" on public.profiles for select
  using (
    role = 'customer'
    and account_status in ('approved', 'suspended')
    and deleted_at is null
    and (
      exists (
        select 1 from public.conversations c
        where c.customer_id = profiles.id and public.is_business_member(c.business_id)
      )
      or exists (
        select 1 from public.follows f
        where f.user_id = profiles.id and public.is_business_member(f.business_id)
      )
    )
  );
create policy "profiles_select_business_broadcast" on public.profiles for select
  using (
    role = 'customer' and account_status = 'approved' and deleted_at is null and public.is_business_user()
  );
create policy "profiles_select_display" on public.profiles for select
  using (
    auth.uid() is not null
    and deleted_at is null
    and (role = 'business' or (role = 'customer' and account_status = 'approved'))
  );
create policy "profiles_update_avatar_own" on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

revoke all on table public.profiles from anon;
revoke update on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
revoke select (phone, phone_normalized) on table public.profiles from authenticated;
grant update (avatar_url) on table public.profiles to authenticated;

-- OTP TOKENS: only service role (API route) touches these
create policy "otp_none"          on public.otp_tokens for all  using (false);

-- ANNOUNCEMENTS: anyone can read; only business admin can insert/update/delete
create policy "announce_read"     on public.announcements for select using (true);
create policy "announce_insert"   on public.announcements for insert
  with check (public.is_business_admin(business_id));
create policy "announce_update"   on public.announcements for update
  using (public.is_business_admin(business_id));
create policy "announce_delete"   on public.announcements for delete
  using (public.is_business_admin(business_id));

-- REACTIONS: anyone can read; authenticated users manage their own
create policy "reactions_read"    on public.reactions for select using (true);
create policy "reactions_own"     on public.reactions for all    using (user_id = auth.uid());

-- COMMENTS: anyone can read; authenticated users manage their own
create policy "comments_read"     on public.comments for select using (true);
create policy "comments_own"      on public.comments for all    using (user_id = auth.uid());

-- CONVERSATIONS: customer sees own; business members see their business's
create policy "convo_customer"    on public.conversations for select
  using (customer_id = auth.uid());
create policy "convo_business"    on public.conversations for select
  using (public.is_business_member(business_id));
create policy "convo_insert"      on public.conversations for insert
  with check (customer_id = auth.uid() and public.is_approved_user());
create policy "convo_update_biz"  on public.conversations for update
  using (public.is_business_member(business_id));

-- MESSAGES: visible to conversation participants only
create policy "msg_read"          on public.messages for select
  using (
    sender_id = auth.uid()
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.customer_id = auth.uid() or public.is_business_member(c.business_id))
    )
  );
create policy "msg_insert"        on public.messages for insert
  with check (sender_id = auth.uid() and public.is_approved_user());

-- FOLLOWS: approved customers may follow/unfollow; staff approval inserts use service role
create policy "follows_read"      on public.follows for select using (true);
create policy "follows_insert_approved" on public.follows for insert
  with check (user_id = auth.uid() and public.is_approved_user());
create policy "follows_delete_own" on public.follows for delete
  using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 11. REALTIME (enable for live messaging & announcements)
-- ────────────────────────────────────────────────────────────
-- Run in Supabase Dashboard → Database → Replication
-- and enable realtime for: messages, conversations, announcements

-- ────────────────────────────────────────────────────────────
-- 12. AUTO-UPDATE updated_at
-- ────────────────────────────────────────────────────────────
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

-- Per-business canned replies for staff inbox (title + body; optional placeholders in body).

create table public.inbox_canned_replies (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title text not null,
  body text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_canned_title_len check (char_length(trim(title)) between 1 and 100),
  constraint inbox_canned_body_len check (char_length(body) between 1 and 8000)
);

create index idx_inbox_canned_replies_business on public.inbox_canned_replies (business_id, sort_order, title);

create trigger set_inbox_canned_replies_updated_at
  before update on public.inbox_canned_replies
  for each row execute function public.set_updated_at();

alter table public.inbox_canned_replies enable row level security;

create policy "inbox_canned_replies_select"
  on public.inbox_canned_replies for select
  using (public.is_business_member(business_id));

create policy "inbox_canned_replies_insert"
  on public.inbox_canned_replies for insert
  with check (public.is_business_member(business_id));

create policy "inbox_canned_replies_update"
  on public.inbox_canned_replies for update
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create policy "inbox_canned_replies_delete"
  on public.inbox_canned_replies for delete
  using (public.is_business_member(business_id));

-- Realtime (optional): enable replication for inbox_canned_replies

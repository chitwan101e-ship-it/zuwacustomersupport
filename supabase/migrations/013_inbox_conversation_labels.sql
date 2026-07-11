-- Staff inbox labels per business (VIP, Priority, …) + custom labels; assignments per conversation.

create table public.inbox_label_definitions (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  color text,
  is_system boolean not null default false,
  preset_key text,
  created_at timestamptz not null default now(),
  constraint inbox_label_name_nonempty check (char_length(trim(name)) between 1 and 48)
);

create unique index inbox_label_defs_business_name_lower
  on public.inbox_label_definitions (business_id, lower(trim(name)));

create unique index inbox_label_defs_business_preset
  on public.inbox_label_definitions (business_id, preset_key)
  where preset_key is not null;

create index idx_inbox_label_defs_business on public.inbox_label_definitions (business_id);

create table public.conversation_inbox_labels (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  label_id uuid not null references public.inbox_label_definitions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, label_id)
);

create index idx_conversation_inbox_labels_label on public.conversation_inbox_labels (label_id);

create or replace function public.conversation_inbox_labels_same_business()
returns trigger
language plpgsql
as $$
declare
  conv_bid uuid;
  lbl_bid uuid;
begin
  select c.business_id into conv_bid from public.conversations c where c.id = new.conversation_id;
  select d.business_id into lbl_bid from public.inbox_label_definitions d where d.id = new.label_id;
  if conv_bid is null then
    raise exception 'conversation not found';
  end if;
  if lbl_bid is null then
    raise exception 'label not found';
  end if;
  if conv_bid <> lbl_bid then
    raise exception 'label and conversation must belong to the same business';
  end if;
  return new;
end;
$$;

create trigger conversation_inbox_labels_same_business
  before insert or update of conversation_id, label_id on public.conversation_inbox_labels
  for each row
  execute function public.conversation_inbox_labels_same_business();

-- Seed default labels for every business (idempotent).
insert into public.inbox_label_definitions (business_id, name, color, is_system, preset_key)
select b.id, x.name, x.color, true, x.preset_key
from public.businesses b
cross join (
  values
    ('vip', 'VIP', '#ca8a04'),
    ('priority', 'Priority', '#ea580c'),
    ('scammer', 'Scammer', '#dc2626'),
    ('follow_up', 'Follow up', '#2563eb')
) as x(preset_key, name, color)
where not exists (
  select 1 from public.inbox_label_definitions d
  where d.business_id = b.id and d.preset_key = x.preset_key
);

create or replace function public.seed_inbox_preset_labels_for_business()
returns trigger
language plpgsql
as $$
begin
  insert into public.inbox_label_definitions (business_id, name, color, is_system, preset_key)
  select new.id, x.name, x.color, true, x.preset_key
  from (
    values
      ('vip', 'VIP', '#ca8a04'),
      ('priority', 'Priority', '#ea580c'),
      ('scammer', 'Scammer', '#dc2626'),
      ('follow_up', 'Follow up', '#2563eb')
  ) as x(preset_key, name, color)
  where not exists (
    select 1 from public.inbox_label_definitions d
    where d.business_id = new.id and d.preset_key = x.preset_key
  );
  return new;
end;
$$;

create trigger businesses_seed_inbox_labels
  after insert on public.businesses
  for each row
  execute function public.seed_inbox_preset_labels_for_business();

alter table public.inbox_label_definitions enable row level security;
alter table public.conversation_inbox_labels enable row level security;

create policy "inbox_label_defs_select"
  on public.inbox_label_definitions for select
  using (public.is_business_member(business_id));

create policy "inbox_label_defs_insert"
  on public.inbox_label_definitions for insert
  with check (
    public.is_business_member(business_id)
    and is_system = false
    and preset_key is null
  );

create policy "inbox_label_defs_update"
  on public.inbox_label_definitions for update
  using (public.is_business_member(business_id) and is_system = false)
  with check (public.is_business_member(business_id) and is_system = false and preset_key is null);

create policy "inbox_label_defs_delete"
  on public.inbox_label_definitions for delete
  using (public.is_business_member(business_id) and is_system = false);

create policy "conversation_inbox_labels_select"
  on public.conversation_inbox_labels for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_inbox_labels.conversation_id
        and public.is_business_member(c.business_id)
    )
  );

create policy "conversation_inbox_labels_insert"
  on public.conversation_inbox_labels for insert
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_inbox_labels.conversation_id
        and public.is_business_member(c.business_id)
    )
    and exists (
      select 1 from public.inbox_label_definitions d
      where d.id = conversation_inbox_labels.label_id
        and public.is_business_member(d.business_id)
    )
  );

create policy "conversation_inbox_labels_delete"
  on public.conversation_inbox_labels for delete
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_inbox_labels.conversation_id
        and public.is_business_member(c.business_id)
    )
  );

-- Realtime (optional): Supabase Dashboard → Replication → enable for conversation_inbox_labels

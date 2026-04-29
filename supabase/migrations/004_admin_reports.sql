do $$
begin
  if not exists (select 1 from pg_type where typname = 'admin_report_status') then
    create type public.admin_report_status as enum ('new', 'in_review', 'resolved');
  end if;
end$$;

create table if not exists public.admin_reports (
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

create index if not exists idx_admin_reports_business on public.admin_reports(business_id);
create index if not exists idx_admin_reports_status on public.admin_reports(status);

alter table public.admin_reports enable row level security;

drop policy if exists "admin_reports_select" on public.admin_reports;
drop policy if exists "admin_reports_insert" on public.admin_reports;
drop policy if exists "admin_reports_update" on public.admin_reports;

create policy "admin_reports_select" on public.admin_reports for select
  using (public.is_business_member(business_id) or reporter_id = auth.uid());
create policy "admin_reports_insert" on public.admin_reports for insert
  with check (reporter_id = auth.uid());
create policy "admin_reports_update" on public.admin_reports for update
  using (public.is_business_member(business_id));

drop trigger if exists set_admin_reports_updated_at on public.admin_reports;
create trigger set_admin_reports_updated_at
  before update on public.admin_reports
  for each row execute function public.set_updated_at();

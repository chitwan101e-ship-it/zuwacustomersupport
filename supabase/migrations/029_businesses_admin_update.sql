-- Allow business admins to update their business row (e.g. logo_url when uploading profile photo).

create policy "businesses_update_admin"
  on public.businesses for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.business_id = businesses.id
        and p.business_role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.business_id = businesses.id
        and p.business_role = 'admin'
    )
  );

grant update on table public.businesses to authenticated;

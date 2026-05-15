-- Vuln 3: signup OTP must be verified before register (verified_at).
-- Vuln 4: only approved customers may follow businesses or open support chats.

alter table public.otp_tokens
  add column if not exists verified_at timestamptz;

create index if not exists idx_otp_tokens_signup_verified
  on public.otp_tokens (email, purpose)
  where used = false and verified_at is not null;

-- ---------------------------------------------------------------------------
-- FOLLOWS: approved customers may follow/unfollow; inserts on approve stay service-role
-- ---------------------------------------------------------------------------
drop policy if exists "follows_own" on public.follows;

create policy "follows_insert_approved"
  on public.follows for insert
  with check (user_id = auth.uid() and public.is_approved_user());

create policy "follows_delete_own"
  on public.follows for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- CONVERSATIONS + MESSAGES: approved customers only
-- ---------------------------------------------------------------------------
drop policy if exists "convo_insert" on public.conversations;
create policy "convo_insert"
  on public.conversations for insert
  with check (customer_id = auth.uid() and public.is_approved_user());

drop policy if exists "msg_insert" on public.messages;
create policy "msg_insert"
  on public.messages for insert
  with check (sender_id = auth.uid() and public.is_approved_user());

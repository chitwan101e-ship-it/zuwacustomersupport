# Relay Staff Dashboard — Performance Fixes Playbook

This document records **everything we changed** to make the Relay admin/staff dashboard fast under load (signup bursts, inbox traffic, tab switching). Use it as a checklist when applying the same patterns to another project.

> **Code & SQL in this doc**
> - **Sections 1–13** — objectives, architecture, and *what* changed (mostly prose + small snippets).
> - **Appendix A** — **full migration SQL** (copy-paste into Supabase SQL editor).
> - **Appendix B** — **full TypeScript** for libs, API routes, and dashboard patterns (copy-paste reference).
> - **Appendix C** — verify RPC exists after migration.

---

## 1. Objective

**Goal:** Keep the staff dashboard responsive when:

- Many customers sign up at once (admin notifications fire for every signup)
- Admins switch between tabs (Home, Inbox, Users, Notify, etc.)
- Realtime events (new messages, read receipts, follows) arrive frequently
- Supabase is under load (network latency, connection limits, row scans)

**Success criteria:**

- Dashboard shows cached data quickly instead of a blank screen for ~1 minute
- Tab clicks feel instant (nav + content stay in sync)
- Background refresh does not block UI or re-fetch the entire world on every event
- Signup/notification spikes do not trigger N full dashboard reloads for N admins

---

## 2. Symptoms Before Fixes

| Symptom | Likely cause |
|--------|----------------|
| Dashboard blank ~30–60s on first load | Monolithic `refreshDashboard()` fetching everything serially |
| Inbox/Users slow to open | Full reload + platform-wide member queries + unbounded conversation list |
| Tab switch feels frozen | ~6k-line page re-rendering all tab JSX on every click |
| Signup burst slows all admins | Each `staff_alert` notification → full dashboard reload per admin |
| Notification page sluggish | Unbounded notification fetch + aggressive polling |
| Unread badge slow | Client fetched every unread message row instead of aggregating in SQL |

---

## 3. Root Causes (Architecture)

1. **Monolithic dashboard page** (`src/app/dashboard/page.tsx`) — one component owned auth, inbox, users, notify, reports, team, realtime, and polling.
2. **Single “full refresh” hot path** — `refreshDashboard()` loaded conversations, all members, pending signups, reports, canned replies, labels, and bell count together.
3. **Over-fetching** — inbox list uncapped; unread counts via row scan; users list sometimes platform-wide instead of business-scoped.
4. **Realtime → full reload** — many postgres events debounced into `refreshDashboard({ scope: 'inbox' })` or worse, full reload on notification insert.
5. **UI anti-patterns** — loading spinners hid cached data; `startTransition` / `useDeferredValue` on tab switch made nav and content feel out of sync (reverted).

---

## 4. Database Layer

**File:** `supabase/migrations/035_performance_indexes.sql`

### 4.1 Server-side unread aggregation (RPC)

Instead of selecting all unread `messages` rows and counting client-side, aggregate in Postgres.

**Full SQL is in [Appendix A](#appendix-a-full-migration-sql)** (`supabase/migrations/035_performance_indexes.sql`).

Summary:
- RPC `inbox_unread_customer_counts(uuid[])` → `(conversation_id, unread_count)`
- Uses `security definer` + `is_business_member()` guard
- Client calls it in chunks of 500 conversation IDs

**Why:** Unread badges and inbox sorting are O(conversations) via RPC, not O(unread messages).

**Porting tip:** Create an RPC that returns `(id, count)` for your entity IDs. Chunk IDs in the client (we use 500 per RPC call).

### 4.2 Partial indexes

**Full `CREATE INDEX` statements are in [Appendix A](#appendix-a-full-migration-sql).**

| Index | Purpose |
|-------|---------|
| `idx_messages_conversation_unread` on `messages(conversation_id) WHERE read IS NOT TRUE` | Faster unread lookups / RPC |
| `idx_profiles_platform_admins` on `profiles(role, business_role) WHERE deleted_at IS NULL AND role = 'business' AND business_role = 'admin'` | Faster “notify all admins” on signup |
| `idx_notifications_user_unread_created` on `notifications(user_id, created_at DESC) WHERE read = false` | Faster bell badge count |

**Porting tip:** Add partial indexes for predicates you use in `WHERE` + hot join columns.

---

## 5. Data Access Layer (TypeScript libs)

### 5.1 Inbox — `src/lib/staffInbox.ts`

| Change | Detail |
|--------|--------|
| **Cap conversation list** | `INBOX_LIST_DEFAULT_MAX = 300` passed to `fetchAllBusinessConversations(..., { maxRows })` |
| **Paginated fetch** | Still pages at 1000 (PostgREST max) but stops at cap |
| **RPC unread counts** | `fetchInboxUnreadCounts()` calls `inbox_unread_customer_counts` in chunks |
| **Legacy fallback** | If RPC missing, falls back to row-scan (for dev before migration runs) |
| **Parallel enrichment** | Dashboard loads profiles, previews, unread counts, label defs in `Promise.all` |

### 5.2 Business-scoped members — `src/lib/resolveCustomerRecipient.ts`

| Change | Detail |
|--------|--------|
| **`listBusinessMemberIds`** | Union of `conversations.customer_id` + `follows.user_id` for one `business_id` |
| **`listBusinessMemberProfiles`** | Fetches profiles only for those IDs (chunked, 200 per query) |
| **`listBusinessApprovedCustomerIds`** | Approved subset for Notify / announcements |
| **`searchCustomersForNotify`** | Search limited to business-linked customers |

**Why:** Avoid loading every customer on the platform when the admin only cares about their business.

**Porting tip:** Replace any “load all users” admin query with “load IDs linked to tenant, then batch-fetch profiles.”

**Full TypeScript is in [Appendix B.2](#b2-resolvecustomerrecipientts--business-scoped-members).**

---

## 6. API / Server Routes

### 6.1 Signup deferral — `src/app/api/auth/register/route.ts`

**Problem:** Signup HTTP response waited on welcome DM, follow, and admin notifications.

**Fix:** `deferRegisterFollowUp()` uses Next.js `after()` to run post-signup work **after** the response:

- `completeCustomerApproval()` (welcome message, follow, etc.)
- `notifyEveryBusinessAdmin()` for signup alerts

**Porting tip:** Any heavy post-mutation work (emails, notifications, webhooks) should not block the user-facing response. Use `after()`, a job queue, or background worker.

### 6.2 Pending signups — `src/app/api/staff/pending-signups/route.ts`

**Fix:** Support `?countOnly=1` for pending count without loading full pending user rows.

**Used when:** Dashboard refresh scope is not `users` (e.g. `light` poll) — only badge count needed.

**Full route code is in [Appendix B.4](#b4-pending-signups-route-countonly).**

---

## 7. Staff Dashboard — Core Refactor

**File:** `src/app/dashboard/page.tsx` (main file; largest impact)

### 7.1 Scoped refresh (`RefreshScope`)

```ts
type RefreshScope = 'full' | 'light' | 'inbox' | 'users'
```

| Scope | Fetches |
|-------|---------|
| `full` | Everything (manual force refresh) |
| `light` | Reports summary, bell count, pending **count only** |
| `inbox` | Conversations (capped), previews, unread RPC, labels, canned replies |
| `users` | Business member profiles, pending list (full detail when `pendingDetail: true`) |

**Implementation notes:**

- `refreshDashboard(p, { scope })` sets flags: `wantInbox`, `wantMembers`, `wantReports`, `wantBell`, etc.
- Skipped queries resolve to empty `Promise.resolve(...)` so `Promise.all` stays parallel.
- **`scopeInflightRef`** — skip duplicate in-flight refresh for the same scope (unless `force: true`).

**Porting tip:** Never have one `loadData()` that always hits every table. Split by “what this screen needs.”

### 7.2 Session cache (`sessionStorage`)

```ts
const DASH_CACHE_TTL_MS = 10 * 60_000 // 10 minutes
// Key: relay-staff-dash-{businessId}
// Stores: convoList, activeMembers, suspendedMembers, pendingCustomers, pendingSignupCount
```

**On login:**

1. `readDashCache(businessId)` → hydrate state immediately
2. Set `loading = false` so UI renders with stale-but-usable data
3. Fire scoped refreshes in background: `light`, `inbox`, `users`

**After successful refresh:** `writeDashCache(...)` updates session storage.

**Porting tip:** Show last-known-good data instantly; refresh in background. Only show full-page spinner when **zero** cached data exists.

### 7.3 Loading UX

| State | Behavior |
|-------|----------|
| `inboxLoading` | `true` only when `convoList.length === 0` |
| `usersLoading` | `true` only when no users cache exists |
| `inboxRefreshing` / `usersRefreshing` | Small banner / spin on Refresh button when data already shown |

**Why:** Spinners that replace the whole panel make the app feel broken even when cached data is valid.

### 7.4 Tab switch behavior

```ts
const switchTab = useCallback((tab: AppTab) => {
  setActiveTab(tab)           // immediate — nav + content use same tab
  setMountedTabs(...)         // keep visited tabs in memory

  requestAnimationFrame(() => {
    // refresh only if stale > 60s
    if (tab === 'inbox') refreshDashboard(..., { scope: 'inbox' })
    if (tab === 'users') refreshDashboard(..., { scope: 'users', pendingDetail: true })
  })
}, [])
```

**Porting tip:** Defer **network** refresh until after paint (`requestAnimationFrame`). Do **not** defer the visible tab state with `useDeferredValue` — it made nav highlight and content feel disconnected.

### 7.5 Lazy tab rendering (`StaffTabPanel`)

**Problem:** React evaluates `{children}` before the panel component runs, so **all mounted tabs’ JSX** was built on every render.

**Fix:** Render prop + cache:

```tsx
<StaffTabPanel
  tab="inbox"
  activeTab={activeTab}
  mountedTabs={mountedTabs}
  render={() => (<> ... huge inbox tree ... </>)}
/>
```

- **Visible tab:** calls `render()` and updates cache
- **Hidden tab:** shows frozen cache, skips `render()` → skips heavy JSX work
- **CSS:** hidden panels use `content-visibility: hidden` + `contain: strict`

Same pattern for **Users sub-tabs** (`StaffUsersSubPanel`: Pending / Active / Suspended).

**Porting tip:** For multi-tab SPA admin UIs, either split into routes (`/admin/inbox`, `/admin/users`) or use lazy render props. Hidden `display:none` alone is not enough — children are still evaluated.

### 7.6 Tab-scoped `useMemo` (CPU)

```ts
const needsInboxLists = activeTab === 'inbox'
const needsUsersLists = activeTab === 'users'
const needsNotifyLists = activeTab === 'notify'
```

Heavy memos (filter/sort inbox, search members, notify recipient list) early-return when off-tab.

**Porting tip:** Gate expensive derived lists by active view, not global state.

### 7.7 Memoized navigation (`DashboardNavButtons`)

Sidebar + mobile nav extracted to `memo(DashboardNavButtons)` so tab content re-renders do not rebuild nav buttons.

### 7.8 Polling (reduced)

| Before | After |
|--------|-------|
| ~30s full refresh | **60s** tab-aware poll |
| Same fetch regardless of tab | `inbox` → inbox scope; `users` → users scope; else `light` |

### 7.9 Realtime — patch, don’t reload

**Messages INSERT:**

- If known conversation + customer message → bump `unreadCount`, preview, `updated_at` in local state
- If team/welcome message → bump preview only
- If unknown conversation → fetch single conversation + profile, append to list
- Avoid full `refreshDashboard` on every message when possible

**Messages UPDATE (read receipt):**

- `patchInboxOnMessageRead` decrements `unreadCount` locally

**Other tables** (conversations, follows, labels, canned replies):

- Debounced `queueRefresh` → `{ scope: 'inbox' }` after **400ms** (coalesce bursts)

**Notifications INSERT (`staff_alert`, `support_message`):**

- **Only** increment bell counter (`setStaffNotifyUnread`)
- **Do not** trigger full dashboard reload (this was critical during signup bursts)

**Porting tip:** Map each realtime event to the smallest state update. Full refetch is the exception.

### 7.10 Inbox thread cleanup when leaving tab

When `activeTab !== 'inbox'`, defer clearing selected thread via `requestAnimationFrame` + `startTransition` so tab switch paint is not blocked.

### 7.11 Pre-mount hot tabs

After login (~50ms timeout), add `inbox` and `users` to `mountedTabs` so first click does not pay mount cost cold.

---

## 8. Notifications Page

**File:** `src/app/notifications/page.tsx`

| Change | Detail |
|--------|--------|
| **Limit fetch** | `.limit(100)` on notification query |
| **Realtime INSERT** | Prepend row, cap list at 100 |
| **Realtime UPDATE** | Patch row in place |
| **Poll interval** | 45s (only when tab visible) |

**Porting tip:** Paginate or cap lists; patch realtime events into local state instead of refetching entire list.

---

## 9. What We Tried That Made Things Worse

| Approach | Why it failed |
|----------|----------------|
| `useDeferredValue(activeTab)` for panel visibility | Nav updated instantly but content lagged → felt broken |
| `useDeferredValue` for Users sub-tabs | Same mismatch |
| Gating memos on deferred tab | Double render phases, harder to reason about |

**Lesson:** Keep **one source of truth** for visible tab (`activeTab`). Optimize **work skipped** (lazy render, scoped fetch), not **when** the user sees the switch.

---

## 10. File Reference

| File | Role |
|------|------|
| `supabase/migrations/035_performance_indexes.sql` | RPC + indexes |
| `src/lib/staffInbox.ts` | Capped conversations, RPC unread |
| `src/lib/resolveCustomerRecipient.ts` | Business-scoped member IDs/profiles |
| `src/app/dashboard/page.tsx` | Scoped refresh, cache, lazy tabs, realtime patches |
| `src/app/api/auth/register/route.ts` | Deferred post-signup work (`after()`) |
| `src/app/api/staff/pending-signups/route.ts` | `countOnly` mode |
| `src/app/notifications/page.tsx` | Capped list + realtime patch |

---

## 11. Porting Checklist (Other Projects)

Use this order:

### Database
- [ ] Identify hottest queries (unread counts, admin lookups, notification badges)
- [ ] Add aggregation RPCs where client currently scans rows
- [ ] Add partial indexes matching `WHERE` clauses on large tables

### API / backend
- [ ] Move post-response work off critical path (`after()`, queue, worker)
- [ ] Add “count only” endpoints for badge/summary data
- [ ] Scope all admin lists to tenant/business ID

### Admin UI
- [ ] Split monolithic refresh into scopes (`full`, `light`, per-section)
- [ ] In-flight mutex per scope to prevent duplicate fetches
- [ ] Session/local cache with TTL; show cache while refreshing
- [ ] Spinners only when no cached data; “Refreshing…” when data exists
- [ ] Lazy-render inactive tabs (render prop pattern)
- [ ] Gate heavy `useMemo` by active tab
- [ ] Memoize sidebar/nav
- [ ] Tab switch: update UI immediately; defer network to `requestAnimationFrame`
- [ ] Realtime: patch local state; debounce full refetch; never full reload on notification-only events

### Intervals
- [ ] Poll ≥ 60s, tab-aware
- [ ] Skip poll when `document.visibilityState !== 'visible'`

### Verify
- [ ] Signup burst: N signups should not cause N × M full admin reloads
- [ ] Tab switch: only active tab JSX runs
- [ ] First load: cached/session data visible in <1s if revisiting within TTL
- [ ] Migration applied: RPC exists (`inbox_unread_customer_counts`)

---

## 12. Optional Next Steps (Not Done Yet)

These were identified but **not** fully implemented — consider for a larger refactor:

1. **Split dashboard into route segments** — `/dashboard/inbox`, `/dashboard/users` as separate Next.js pages (best long-term)
2. **Extract tab components to separate files** — smaller bundles, easier memo boundaries
3. **Supabase plan/region** — if queries are still slow after indexes, check DB region vs app region and connection pooling
4. **Server Components / RSC** — move initial inbox/users fetch to server for faster first paint

---

## 13. Quick “Is It Code or Network?” Test

| Observation | Likely cause |
|-------------|--------------|
| Tab highlight slow | Frontend render path |
| Content lags after highlight with no spinner | Frontend (was deferred tab — avoid) |
| “Refreshing…” / spinner for several seconds | Supabase / network |
| Blank dashboard 30s+ on first visit | Unscoped fetch or missing cache |
| Slow only during signup waves | Notification-triggered reload storm (fix realtime + defer signup) |

---

*Last updated: July 2026 — Relay (JBComs) staff dashboard performance pass.*

---

## Appendix A: Full migration SQL

Run this in the Supabase SQL editor (or via `supabase db push`). File: `supabase/migrations/035_performance_indexes.sql`.

```sql
-- Faster inbox unread counts (aggregate server-side instead of fetching every unread row).

create or replace function public.inbox_unread_customer_counts(p_conversation_ids uuid[])
returns table(conversation_id uuid, unread_count bigint)
language sql
security definer
set search_path = public
as $$
  select m.conversation_id, count(*)::bigint as unread_count
  from public.messages m
  inner join public.conversations c on c.id = m.conversation_id
  where m.conversation_id = any(p_conversation_ids)
    and m.read is not true
    and m.sender_id = c.customer_id
    and public.is_business_member(c.business_id)
  group by m.conversation_id;
$$;

revoke all on function public.inbox_unread_customer_counts(uuid[]) from public;
grant execute on function public.inbox_unread_customer_counts(uuid[]) to authenticated;

-- Unread message lookups (inbox badge aggregation).
create index if not exists idx_messages_conversation_unread
  on public.messages (conversation_id)
  where read is not true;

-- Platform-wide admin lookup for signup alerts.
create index if not exists idx_profiles_platform_admins
  on public.profiles (role, business_role)
  where deleted_at is null
    and role = 'business'
    and business_role = 'admin';

-- Notification badge counts.
create index if not exists idx_notifications_user_unread_created
  on public.notifications (user_id, created_at desc)
  where read = false;
```

### Verify migration applied

```sql
select proname, proargtypes::regtype[]
from pg_proc
where proname = 'inbox_unread_customer_counts';
```

---

## Appendix B: Full TypeScript reference

### B.1 `staffInbox.ts` — capped list + RPC unread

File: `src/lib/staffInbox.ts`

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export const CONVO_LIST_PAGE_SIZE = 1000
export const INBOX_PREVIEW_CHUNK = 500
export const INBOX_QUERY_CHUNK = 200
export const INBOX_LIST_DEFAULT_MAX = 300

export type BusinessConversationRow = {
  id: string
  customer_id: string
  updated_at: string
}

/** Load support threads for a business (paginated, optional cap). */
export async function fetchAllBusinessConversations(
  client: SupabaseClient,
  businessId: string,
  opts?: { maxRows?: number }
): Promise<BusinessConversationRow[]> {
  const maxRows = opts?.maxRows
  const rows: BusinessConversationRow[] = []
  let from = 0
  while (true) {
    const pageSize =
      maxRows != null ? Math.min(CONVO_LIST_PAGE_SIZE, maxRows - rows.length) : CONVO_LIST_PAGE_SIZE
    if (maxRows != null && pageSize <= 0) break

    const { data, error } = await client
      .from('conversations')
      .select('id, customer_id, updated_at')
      .eq('business_id', businessId)
      .order('updated_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data?.length) break
    for (const row of data) {
      rows.push(row as BusinessConversationRow)
    }
    if (maxRows != null && rows.length >= maxRows) break
    if (data.length < pageSize) break
    from += pageSize
  }
  return rows
}

/** Unread inbound customer messages per conversation (chunked RPC, legacy fallback). */
export async function fetchInboxUnreadCounts(
  client: SupabaseClient,
  convoRows: BusinessConversationRow[]
): Promise<Record<string, number>> {
  const unreadByConvo: Record<string, number> = {}
  const convIds = convoRows.map((r) => r.id)
  if (convIds.length === 0) return unreadByConvo

  for (let i = 0; i < convIds.length; i += INBOX_PREVIEW_CHUNK) {
    const slice = convIds.slice(i, i + INBOX_PREVIEW_CHUNK)
    const { data: counts, error: rpcErr } = await client.rpc('inbox_unread_customer_counts', {
      p_conversation_ids: slice,
    })
    if (rpcErr) {
      Object.assign(unreadByConvo, await fetchInboxUnreadCountsLegacy(client, convoRows, slice))
      continue
    }
    for (const row of counts || []) {
      const r = row as { conversation_id: string; unread_count: number | string }
      unreadByConvo[r.conversation_id] = Number(r.unread_count) || 0
    }
  }
  return unreadByConvo
}

/** Fallback when inbox_unread_customer_counts RPC is missing. */
async function fetchInboxUnreadCountsLegacy(
  client: SupabaseClient,
  convoRows: BusinessConversationRow[],
  convIds: string[]
): Promise<Record<string, number>> {
  const unreadByConvo: Record<string, number> = {}
  const customerByConvo = Object.fromEntries(convoRows.map((r) => [r.id, r.customer_id]))

  for (let i = 0; i < convIds.length; i += INBOX_QUERY_CHUNK) {
    const slice = convIds.slice(i, i + INBOX_QUERY_CHUNK)
    const { data: unreadRows, error: ue } = await client
      .from('messages')
      .select('conversation_id, sender_id')
      .in('conversation_id', slice)
      .or('read.eq.false,read.is.null')
    if (ue) throw ue
    for (const m of unreadRows || []) {
      const row = m as { conversation_id: string; sender_id: string }
      const cust = customerByConvo[row.conversation_id]
      if (cust && row.sender_id === cust) {
        unreadByConvo[row.conversation_id] = (unreadByConvo[row.conversation_id] || 0) + 1
      }
    }
  }
  return unreadByConvo
}
```

**Dashboard usage** (inside `refreshDashboard` when `wantInbox`):

```typescript
const convoPromise = wantInbox
  ? fetchAllBusinessConversations(supabase, bid, { maxRows: INBOX_LIST_DEFAULT_MAX })
  : Promise.resolve({ rows: [] })

// After convo rows loaded, parallel enrichment:
const [profileById, previewByConvo, unreadByConvo, defResult] = await Promise.all([
  loadConvoProfiles(),
  fetchInboxPreviews(supabase, convIds),
  fetchInboxUnreadCounts(supabase, convoRows),
  supabase.from('inbox_label_definitions').select('...').eq('business_id', bid),
])
```

---

### B.2 `resolveCustomerRecipient.ts` — business-scoped members

File: `src/lib/resolveCustomerRecipient.ts`

```typescript
const MEMBER_PROFILE_CHUNK = 200
const MEMBER_ID_PAGE_SIZE = 1000 // existing constant in file

async function fetchBusinessMemberIdColumn(
  client: SupabaseClient,
  businessId: string,
  table: 'conversations' | 'follows',
  column: 'customer_id' | 'user_id'
): Promise<string[]> {
  const ids: string[] = []
  let from = 0
  while (true) {
    const { data, error } = await client
      .from(table)
      .select(column)
      .eq('business_id', businessId)
      .range(from, from + MEMBER_ID_PAGE_SIZE - 1)
    if (error) throw error
    if (!data?.length) break
    for (const row of data) {
      const id = (row as Record<string, string>)[column]
      if (id) ids.push(id)
    }
    if (data.length < MEMBER_ID_PAGE_SIZE) break
    from += MEMBER_ID_PAGE_SIZE
  }
  return ids
}

/** IDs from support threads + followers for one business. */
export async function listBusinessMemberIds(
  client: SupabaseClient,
  businessId: string
): Promise<string[]> {
  const memberIds = new Set<string>()
  const [convIds, followIds] = await Promise.all([
    fetchBusinessMemberIdColumn(client, businessId, 'conversations', 'customer_id'),
    fetchBusinessMemberIdColumn(client, businessId, 'follows', 'user_id'),
  ])
  for (const id of convIds) memberIds.add(id)
  for (const id of followIds) memberIds.add(id)
  return [...memberIds]
}

/** Profiles for business-linked customers only (chunked). */
export async function listBusinessMemberProfiles(
  client: SupabaseClient,
  businessId: string,
  opts?: { statuses?: ('approved' | 'suspended')[] }
): Promise<CustomerProfileSummary[]> {
  const statuses = opts?.statuses ?? ['approved', 'suspended']
  const memberIds = await listBusinessMemberIds(client, businessId)
  if (memberIds.length === 0) return []

  const rows: CustomerProfileSummary[] = []
  for (let i = 0; i < memberIds.length; i += MEMBER_PROFILE_CHUNK) {
    const slice = memberIds.slice(i, i + MEMBER_PROFILE_CHUNK)
    const { data, error } = await client
      .from('profiles')
      .select('id, first_name, last_name, username, account_status, avatar_url')
      .in('id', slice)
      .eq('role', 'customer')
      .in('account_status', statuses)
      .is('deleted_at', null)
    if (error) throw error
    for (const row of data || []) {
      rows.push({ /* map fields */ })
    }
  }
  rows.sort((a, b) => (a.username || '').localeCompare(b.username || ''))
  return rows
}
```

---

### B.3 `register/route.ts` — defer post-signup work

File: `src/app/api/auth/register/route.ts`

```typescript
import { after } from 'next/server'

/** Run welcome/notification work after the HTTP response to shorten signup under DB load. */
function deferRegisterFollowUp(task: () => Promise<void>) {
  after(() => {
    void task().catch((err) => console.error('[register] deferred follow-up:', err))
  })
}

// After successful auth + profile insert, instead of awaiting heavy work inline:
deferRegisterFollowUp(async () => {
  await completeCustomerApproval(supabase, {
    customerId: userIdForApproval,
    customerName: customerNameForApproval,
    username: cleanUsernameForApproval,
    email: emailNormForApproval,
    businessId: target.id,
    businessName: target.name,
    staffSenderId: target.staffSenderId,
  })
})

deferRegisterFollowUp(async () => {
  await notifyEveryBusinessAdmin(supabase, {
    title: 'New customer signup pending',
    body: `@${cleanUsername} (${customerName}) — ...`,
    link: '/notifications',
  })
})
```

---

### B.4 Pending signups route — `countOnly`

File: `src/app/api/staff/pending-signups/route.ts`

```typescript
export async function GET(req: Request) {
  const url = new URL(req.url)
  const countOnly = url.searchParams.get('countOnly') === '1'
  // ... auth checks ...

  if (countOnly) {
    const { count, error: countErr } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'customer')
      .eq('account_status', 'pending')
      .is('deleted_at', null)
    if (countErr) {
      return NextResponse.json({ error: countErr.message }, { status: 500 })
    }
    return NextResponse.json({ count: count ?? 0 })
  }

  // ... full pending list fetch ...
}
```

**Dashboard call:**

```typescript
const pendingFetch = fetch(
  wantPendingDetail
    ? '/api/staff/pending-signups'
    : '/api/staff/pending-signups?countOnly=1',
  { method: 'GET', cache: 'no-store' }
)
```

---

### B.5 Dashboard — session cache

File: `src/app/dashboard/page.tsx`

```typescript
const DASH_CACHE_TTL_MS = 10 * 60_000

type DashSessionCache = {
  at: number
  convoList: ConvoListItem[]
  activeMembers: CustomerProfileSummary[]
  suspendedMembers: CustomerProfileSummary[]
  pendingCustomers: PendingCustomer[]
  pendingSignupCount: number
}

function dashCacheKey(businessId: string) {
  return `relay-staff-dash-${businessId}`
}

function readDashCache(businessId: string): DashSessionCache | null {
  try {
    const raw = sessionStorage.getItem(dashCacheKey(businessId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DashSessionCache
    if (!parsed?.at || Date.now() - parsed.at > DASH_CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeDashCache(businessId: string, data: Omit<DashSessionCache, 'at'>) {
  try {
    sessionStorage.setItem(dashCacheKey(businessId), JSON.stringify({ ...data, at: Date.now() }))
  } catch {
    /* quota / private mode */
  }
}

// On login init:
const cached = readDashCache(pRow.business_id!)
if (cached) {
  setConvoList(cached.convoList)
  setActiveMembers(cached.activeMembers)
  setSuspendedMembers(cached.suspendedMembers)
  setPendingCustomers(cached.pendingCustomers ?? [])
  setPendingSignupCount(cached.pendingSignupCount)
  scopeLoadedAtRef.current.inbox = cached.at
  scopeLoadedAtRef.current.users = cached.at
  scopeLoadedAtRef.current.light = cached.at
}
setProfile(pRow)
setLoading(false)
void refreshDashboardRef.current(pRow, { scope: 'light' })
void refreshDashboardRef.current(pRow, { scope: 'inbox' })
void refreshDashboardRef.current(pRow, { scope: 'users', pendingDetail: true })
```

---

### B.6 Dashboard — scoped `refreshDashboard`

```typescript
type RefreshScope = 'full' | 'light' | 'inbox' | 'users'

const scopeInflightRef = useRef<Partial<Record<RefreshScope, boolean>>>({})

const refreshDashboard = useCallback(async (p: ProfileRow, opts?: {
  pendingDetail?: boolean
  scope?: RefreshScope
  force?: boolean
}) => {
  const scope = opts?.scope ?? 'full'
  if (scopeInflightRef.current[scope] && !opts?.force) return

  scopeInflightRef.current[scope] = true
  const wantInbox = scope === 'full' || scope === 'inbox'
  const wantMembers = scope === 'full' || scope === 'users'
  const wantCanned = scope === 'full' || scope === 'inbox'
  const wantReports = scope === 'full' || scope === 'light'
  const wantBell = scope === 'full' || scope === 'light'
  const wantPendingDetail =
    opts?.pendingDetail ?? (scope === 'users' || activeTabRef.current === 'users')

  // Only show blocking spinner when no cached data:
  if (wantInbox && convoListRef.current.length === 0) setInboxLoading(true)
  const hasUsersCache = /* activeMembers || suspended || pending */ 
  if (wantMembers && !hasUsersCache) setUsersLoading(true)

  try {
    const [convoRes, pendingRes, reportRes, memberProfilesRes, cannedRes] = await Promise.all([
      wantInbox ? fetchAllBusinessConversations(...) : Promise.resolve({ rows: [] }),
      fetch(wantPendingDetail ? '/api/staff/pending-signups' : '/api/staff/pending-signups?countOnly=1'),
      wantReports ? supabase.from('admin_reports').select(...) : Promise.resolve({ data: [] }),
      wantMembers ? listBusinessMemberProfiles(supabase, bid) : Promise.resolve({ rows: [] }),
      wantCanned ? supabase.from('inbox_canned_replies').select(...) : Promise.resolve({ data: null }),
    ])
    // ... merge results, writeDashCache, scopeLoadedAtRef.current[scope] = Date.now()
  } finally {
    if (wantInbox) setInboxLoading(false)
    if (wantMembers) setUsersLoading(false)
    scopeInflightRef.current[scope] = false
  }
}, [supabase])
```

---

### B.7 Dashboard — lazy tab panel (`StaffTabPanel`)

```typescript
function StaffTabPanel({
  tab,
  activeTab,
  mountedTabs,
  className,
  render,
}: {
  tab: AppTab
  activeTab: AppTab
  mountedTabs: ReadonlySet<AppTab>
  className?: string
  render: () => ReactNode
}) {
  const cacheRef = useRef<ReactNode>(null)
  const hasRenderedRef = useRef(false)

  if (!mountedTabs.has(tab)) return null
  const visible = activeTab === tab

  if (visible) {
    const content = render()
    cacheRef.current = content
    hasRenderedRef.current = true
    return <section className={className}>{content}</section>
  }

  if (!hasRenderedRef.current || cacheRef.current == null) return null

  return (
    <section
      hidden
      className="hidden [content-visibility:hidden] [contain:strict] pointer-events-none"
      aria-hidden
    >
      {cacheRef.current}
    </section>
  )
}

// Usage — MUST use render prop (not children) so inactive tabs skip JSX evaluation:
<StaffTabPanel tab="inbox" activeTab={activeTab} mountedTabs={mountedTabs} render={() => (
  <> ... entire inbox UI ... </>
)} />
```

---

### B.8 Dashboard — tab switch + polling

```typescript
const switchTab = useCallback((tab: AppTab) => {
  setActiveTab(tab)
  setMountedTabs((prev) => {
    if (prev.has(tab)) return prev
    return new Set(prev).add(tab)
  })

  window.requestAnimationFrame(() => {
    const p = profileRef.current
    if (!p?.business_id) return
    const staleMs = 60_000
    const now = Date.now()
    if (tab === 'inbox' && now - (scopeLoadedAtRef.current.inbox ?? 0) > staleMs) {
      void refreshDashboardRef.current(p, { scope: 'inbox' })
    } else if (tab === 'users' && now - (scopeLoadedAtRef.current.users ?? 0) > staleMs) {
      void refreshDashboardRef.current(p, { scope: 'users', pendingDetail: true })
    }
  })
}, [])

// Tab-aware poll every 60s:
useEffect(() => {
  const id = window.setInterval(() => {
    const p = profileRef.current
    if (!p?.business_id) return
    const tab = activeTabRef.current
    if (tab === 'inbox') void refreshDashboard(p, { scope: 'inbox' })
    else if (tab === 'users') void refreshDashboard(p, { pendingDetail: true, scope: 'users' })
    else void refreshDashboard(p, { scope: 'light' })
  }, 60_000)
  return () => window.clearInterval(id)
}, [refreshDashboard])
```

---

### B.9 Dashboard — realtime patches (no full reload on every event)

```typescript
const queueRefresh = () => {
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    void refreshDashboard(profileRef.current!, { scope: 'inbox' })
  }, 400)
}

const patchInboxOnMessageRead = (payload) => {
  // decrement unreadCount locally when customer message marked read
  setConvoList((list) =>
    list.map((c) =>
      c.id === msg.conversation_id ? { ...c, unreadCount: Math.max(0, c.unreadCount - 1) } : c
    )
  )
}

const bumpInboxOnCustomerMessage = (payload): boolean => {
  // bump unread + preview + move thread to top — return true if handled
  setConvoList((prev) => { /* ... */ })
  return true
}

// Realtime subscription:
supabase
  .channel(`staff-dashboard-${businessId}`)
  .on('postgres_changes', { event: '*', table: 'conversations', filter: `business_id=eq.${businessId}` }, queueRefresh)
  .on('postgres_changes', { event: 'INSERT', table: 'messages' }, (payload) => {
    if (bumpInboxOnCustomerMessage(payload)) return
    if (bumpInboxOnTeamMessage(payload)) return
    resolveInboundCustomerMessage(payload)
    resolveOutboundTeamMessage(payload)
  })
  .on('postgres_changes', { event: 'UPDATE', table: 'messages' }, patchInboxOnMessageRead)
  .subscribe()

// Bell only — do NOT refreshDashboard on staff_alert INSERT:
.on('postgres_changes', { event: 'INSERT', table: 'notifications', filter: `user_id=eq.${uid}` }, (payload) => {
  const row = payload.new as { type?: string; read?: boolean }
  if (row?.read) return
  if (row?.type === 'support_message' || row?.type === 'staff_alert') {
    setStaffNotifyUnread((n) => n + 1)
  }
})
```

---

### B.10 Notifications page — cap + realtime patch

File: `src/app/notifications/page.tsx`

```typescript
const { data, error } = await supabase
  .from('notifications')
  .select('id, type, title, body, link, read, created_at')
  .eq('user_id', uid)
  .order('created_at', { ascending: false })
  .limit(100)

// Realtime INSERT — prepend, cap at 100:
setItems((prev) => {
  if (prev.some((n) => n.id === row.id)) return prev
  return [row, ...prev].slice(0, 100)
})

// Poll every 45s when visible:
timer = window.setInterval(() => {
  if (document.visibilityState !== 'visible') return
  void load(uid)
}, 45_000)
```

---

## Appendix C: Quick verify checklist

```bash
# Typecheck after porting dashboard changes
npx tsc --noEmit
```

```sql
-- RPC exists
select proname from pg_proc where proname = 'inbox_unread_customer_counts';

-- Indexes exist
select indexname from pg_indexes
where indexname in (
  'idx_messages_conversation_unread',
  'idx_profiles_platform_admins',
  'idx_notifications_user_unread_created'
);
```

For the **complete** live source (including the full 6k-line dashboard), see the repo files listed in [Section 10](#10-file-reference). Appendix B is the portable subset to copy into another project.


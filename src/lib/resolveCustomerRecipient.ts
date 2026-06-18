import type { SupabaseClient } from '@supabase/supabase-js'

export type ResolvedCustomerRecipient = {
  id: string
  username: string
  first_name: string | null
  last_name: string | null
  account_status: string
  email: string | null
}

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase()
}

function looksLikeEmail(raw: string): boolean {
  return raw.trim().includes('@')
}

async function authEmailForUser(admin: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data.user?.email) return null
    return data.user.email.trim().toLowerCase()
  } catch {
    return null
  }
}

async function profileById(
  admin: SupabaseClient,
  userId: string
): Promise<Omit<ResolvedCustomerRecipient, 'email'> | null> {
  const { data: prof, error } = await admin
    .from('profiles')
    .select('id, username, first_name, last_name, role, account_status, deleted_at')
    .eq('id', userId)
    .maybeSingle()
  if (error || !prof || prof.role !== 'customer' || prof.deleted_at) return null
  return {
    id: prof.id as string,
    username: (prof.username as string) ?? '',
    first_name: (prof.first_name as string | null) ?? null,
    last_name: (prof.last_name as string | null) ?? null,
    account_status: (prof.account_status as string) ?? '',
  }
}

/**
 * Resolve a customer by UUID, @username, username, or email (auth.users).
 */
export async function resolveCustomerRecipient(
  admin: SupabaseClient,
  identifier: string
): Promise<ResolvedCustomerRecipient | null> {
  const raw = identifier.trim()
  if (!raw) return null

  if (/^[0-9a-f-]{36}$/i.test(raw)) {
    const prof = await profileById(admin, raw)
    if (!prof) return null
    const email = await authEmailForUser(admin, prof.id)
    return { ...prof, email }
  }

  if (looksLikeEmail(raw)) {
    const emailLower = raw.toLowerCase()
    const { data: userId, error: rpcErr } = await admin.rpc('relay_auth_user_id_for_email', {
      p_email: emailLower,
    })
    if (!rpcErr && userId && typeof userId === 'string') {
      const prof = await profileById(admin, userId)
      if (prof) {
        return { ...prof, email: emailLower }
      }
    }
  }

  const username = normalizeUsername(raw)
  if (!username) return null

  const baseSelect =
    'id, username, first_name, last_name, role, account_status, deleted_at' as const

  const { data: exactProf, error: exactErr } = await admin
    .from('profiles')
    .select(baseSelect)
    .ilike('username', username)
    .eq('role', 'customer')
    .is('deleted_at', null)
    .maybeSingle()

  let prof = exactErr ? null : exactProf

  if (!prof) {
    const { data: partialRows, error: partialErr } = await admin
      .from('profiles')
      .select(baseSelect)
      .ilike('username', `%${username}%`)
      .eq('role', 'customer')
      .is('deleted_at', null)
      .order('username')
      .limit(10)
    if (!partialErr && partialRows?.length) {
      prof =
        partialRows.find((r) => normalizeUsername((r.username as string) ?? '') === username) ??
        (partialRows.length === 1 ? partialRows[0] : null)
    }
  }

  if (!prof) return null

  const id = prof.id as string
  const email = await authEmailForUser(admin, id)
  return {
    id,
    username: (prof.username as string) ?? '',
    first_name: (prof.first_name as string | null) ?? null,
    last_name: (prof.last_name as string | null) ?? null,
    account_status: (prof.account_status as string) ?? '',
    email,
  }
}

/** PostgREST returns at most 1000 rows per request unless paginated. */
const MEMBER_ID_PAGE_SIZE = 1000

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

/** Approved customers linked to a business via follow or support thread. */
export async function listBusinessMemberIds(client: SupabaseClient, businessId: string): Promise<string[]> {
  const memberIds = new Set<string>()
  const [convIds, followIds] = await Promise.all([
    fetchBusinessMemberIdColumn(client, businessId, 'conversations', 'customer_id'),
    fetchBusinessMemberIdColumn(client, businessId, 'follows', 'user_id'),
  ])
  for (const id of convIds) memberIds.add(id)
  for (const id of followIds) memberIds.add(id)
  return [...memberIds]
}

/**
 * Search approved business-linked customers by name, @username, or email.
 */
export async function searchCustomersForNotify(
  admin: SupabaseClient,
  businessId: string,
  query: string
): Promise<ResolvedCustomerRecipient[]> {
  const memberIds = await listBusinessMemberIds(admin, businessId)
  if (memberIds.length === 0) return []

  const q = query.trim().toLowerCase()
  const idChunk = 200
  const profiles: Omit<ResolvedCustomerRecipient, 'email'>[] = []

  for (let i = 0; i < memberIds.length; i += idChunk) {
    const slice = memberIds.slice(i, i + idChunk)
    const { data: rows, error } = await admin
      .from('profiles')
      .select('id, username, first_name, last_name, account_status')
      .in('id', slice)
      .eq('role', 'customer')
      .eq('account_status', 'approved')
      .is('deleted_at', null)
    if (error) throw error
    for (const row of rows || []) {
      profiles.push({
        id: row.id as string,
        username: (row.username as string) ?? '',
        first_name: (row.first_name as string | null) ?? null,
        last_name: (row.last_name as string | null) ?? null,
        account_status: (row.account_status as string) ?? '',
      })
    }
  }

  if (!q) {
    return profiles
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, 200)
      .map((p) => ({ ...p, email: null }))
  }

  const emailHitId = looksLikeEmail(q)
    ? ((await admin.rpc('relay_auth_user_id_for_email', { p_email: q })).data as string | null)
    : null

  const matched: Omit<ResolvedCustomerRecipient, 'email'>[] = []
  for (const p of profiles) {
    const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim().toLowerCase()
    const username = (p.username || '').toLowerCase()
    if (
      p.id === emailHitId ||
      username.includes(q) ||
      username.includes(q.replace(/^@+/, '')) ||
      name.includes(q)
    ) {
      matched.push(p)
    }
  }

  const withEmail: ResolvedCustomerRecipient[] = []
  for (const p of matched.slice(0, 50)) {
    const email = await authEmailForUser(admin, p.id)
    if (q.includes('@') && email && !email.includes(q)) {
      if (p.id !== emailHitId) continue
    }
    withEmail.push({ ...p, email })
  }

  if (emailHitId && !withEmail.some((p) => p.id === emailHitId)) {
    const prof = profiles.find((p) => p.id === emailHitId)
    if (prof) {
      withEmail.unshift({ ...prof, email: q })
    }
  }

  const merged = new Map<string, ResolvedCustomerRecipient>()
  for (const p of withEmail) merged.set(p.id, p)

  if (q.length >= 2) {
    const global = await resolveCustomerRecipient(admin, query)
    if (global && global.account_status === 'approved') {
      merged.set(global.id, global)
    }
  }

  return [...merged.values()].sort((a, b) => a.username.localeCompare(b.username)).slice(0, 50)
}

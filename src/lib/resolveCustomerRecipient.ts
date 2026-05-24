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
  const s = raw.trim().toLowerCase()
  return s.includes('@') && s.includes('.')
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

  const { data: prof, error } = await admin
    .from('profiles')
    .select('id, username, first_name, last_name, role, account_status, deleted_at')
    .ilike('username', username)
    .eq('role', 'customer')
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !prof) return null

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

export async function listBusinessMemberIds(admin: SupabaseClient, businessId: string): Promise<string[]> {
  const memberIds = new Set<string>()
  const [{ data: convos }, { data: follows }] = await Promise.all([
    admin.from('conversations').select('customer_id').eq('business_id', businessId),
    admin.from('follows').select('user_id').eq('business_id', businessId),
  ])
  for (const r of convos || []) memberIds.add((r as { customer_id: string }).customer_id)
  for (const r of follows || []) memberIds.add((r as { user_id: string }).user_id)
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

  return withEmail.sort((a, b) => a.username.localeCompare(b.username))
}

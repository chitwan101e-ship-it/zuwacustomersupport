import { createClient } from '@/lib/supabase/client'

type SupabaseBrowserClient = ReturnType<typeof createClient>

/** Unread inbound (staff) messages across all of the customer's conversations. */
export async function countUnreadStaffMessages(
  supabase: SupabaseBrowserClient,
  customerId: string
): Promise<{ count: number; error: string | null }> {
  const { data: convos, error: cErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('customer_id', customerId)

  if (cErr) return { count: 0, error: cErr.message }
  const ids = (convos || []).map((c) => (c as { id: string }).id)
  if (ids.length === 0) return { count: 0, error: null }

  const QUERY_CHUNK = 200
  let total = 0
  for (let i = 0; i < ids.length; i += QUERY_CHUNK) {
    const slice = ids.slice(i, i + QUERY_CHUNK)
    const { count, error } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .in('conversation_id', slice)
      .neq('sender_id', customerId)
      .or('read.eq.false,read.is.null')
    if (error) return { count: 0, error: error.message }
    total += count ?? 0
  }
  return { count: total, error: null }
}

export type ChatPreview = {
  conversationId: string
  businessId: string
  lastBody: string
  lastAt: string
  lastSenderIsCustomer: boolean
  unreadFromTeam: number
}

/** Conversations with at least one unread team message (for triage badges). */
export function countConversationsWithUnreadFromTeam(previews: Map<string, ChatPreview>): number {
  let n = 0
  for (const pv of previews.values()) {
    if (pv.unreadFromTeam > 0) n++
  }
  return n
}

/** Last message + unread counts per conversation for the customer inbox list. */
export async function loadCustomerChatPreviews(
  supabase: SupabaseBrowserClient,
  customerId: string
): Promise<{ previews: Map<string, ChatPreview>; error: string | null }> {
  const { data: convos, error: cErr } = await supabase
    .from('conversations')
    .select('id, business_id')
    .eq('customer_id', customerId)

  if (cErr) return { previews: new Map(), error: cErr.message }
  const list = (convos || []) as { id: string; business_id: string }[]
  if (list.length === 0) return { previews: new Map(), error: null }

  const convIds = list.map((c) => c.id)
  const convMeta = new Map(list.map((c) => [c.id, c]))

  const QUERY_CHUNK = 200
  const rows: {
    conversation_id: string
    sender_id: string
    body: string
    created_at: string
    read: boolean | null
    image_url?: string | null
  }[] = []

  for (let i = 0; i < convIds.length; i += QUERY_CHUNK) {
    const slice = convIds.slice(i, i + QUERY_CHUNK)
    const { data: msgs, error: mErr } = await supabase
      .from('messages')
      .select('id, conversation_id, sender_id, body, created_at, read, image_url')
      .in('conversation_id', slice)
    if (mErr) return { previews: new Map(), error: mErr.message }
    rows.push(...((msgs || []) as typeof rows))
  }

  type M = (typeof rows)[number]

  const latestByConvo = new Map<string, M>()
  for (const m of rows) {
    const cur = latestByConvo.get(m.conversation_id)
    if (!cur || new Date(m.created_at) > new Date(cur.created_at)) latestByConvo.set(m.conversation_id, m)
  }

  const unreadStaffByConvo = new Map<string, number>()
  for (const m of rows) {
    if (m.sender_id === customerId) continue
    if (m.read === true) continue
    unreadStaffByConvo.set(m.conversation_id, (unreadStaffByConvo.get(m.conversation_id) || 0) + 1)
  }

  const previews = new Map<string, ChatPreview>()
  for (const [convoId, meta] of convMeta) {
    const last = latestByConvo.get(convoId)
    const unread = unreadStaffByConvo.get(convoId) || 0
    if (!last) {
      previews.set(meta.business_id, {
        conversationId: convoId,
        businessId: meta.business_id,
        lastBody: 'No messages yet',
        lastAt: new Date(0).toISOString(),
        lastSenderIsCustomer: false,
        unreadFromTeam: unread,
      })
      continue
    }
    const body =
      last.image_url && (!last.body?.trim() || last.body === '📷')
        ? '📷 Photo'
        : (last.body || '').trim() || (last.image_url ? '📷 Photo' : 'Message')
    previews.set(meta.business_id, {
      conversationId: convoId,
      businessId: meta.business_id,
      lastBody: body.slice(0, 80),
      lastAt: last.created_at,
      lastSenderIsCustomer: last.sender_id === customerId,
      unreadFromTeam: unread,
    })
  }

  return { previews, error: null }
}

/** Shared helpers for quoted message replies in support chat. */

export type ReplyProfileEmbed = {
  username?: string
  first_name?: string | null
  last_name?: string | null
  role?: string | null
  business_role?: string | null
}

export type MessageReplyEmbed = {
  id: string
  sender_id: string
  body: string
  image_url?: string | null
  profiles?: ReplyProfileEmbed | ReplyProfileEmbed[] | null
}

export type ReplyTargetMessage = {
  id: string
  sender_id: string
  body: string
  image_url?: string | null
  profiles?: ReplyProfileEmbed | ReplyProfileEmbed[] | null
}

const CUSTOMER_REPLY_PROFILE = 'username, first_name, last_name, role, business_role, avatar_url'

const STAFF_REPLY_PROFILE = 'username, first_name, last_name, business_role'

/**
 * Do not embed `reply_to:messages!…` — that self-join returns HTTP 400 on this
 * Supabase project (relationship / schema-cache mismatch). Quoted replies are
 * filled client-side via hydrateReplyEmbeds (+ a small parent-id fetch).
 */
export const CUSTOMER_MESSAGE_SELECT =
  `id, conversation_id, sender_id, body, created_at, image_url, read, read_at, reply_to_message_id, profiles ( ${CUSTOMER_REPLY_PROFILE} )` as const

export const THREAD_MESSAGE_SELECT =
  `id, sender_id, body, created_at, image_url, read, read_at, reply_to_message_id, profiles ( ${STAFF_REPLY_PROFILE} )` as const

/** @deprecated Same as THREAD_MESSAGE_SELECT — kept for call sites that still import it. */
export const THREAD_MESSAGE_SELECT_LEGACY = THREAD_MESSAGE_SELECT

/** Absolute fallback when reply_to_message_id column does not exist yet. */
export const THREAD_MESSAGE_SELECT_BASE =
  `id, sender_id, body, created_at, image_url, read, read_at, profiles ( ${STAFF_REPLY_PROFILE} )` as const

/** @deprecated Same as CUSTOMER_MESSAGE_SELECT — kept for call sites that still import it. */
export const CUSTOMER_MESSAGE_SELECT_LEGACY = CUSTOMER_MESSAGE_SELECT

/** Absolute fallback when reply_to_message_id column does not exist yet. */
export const CUSTOMER_MESSAGE_SELECT_BASE =
  `id, conversation_id, sender_id, body, created_at, image_url, read, read_at, profiles ( ${CUSTOMER_REPLY_PROFILE} )` as const

export function isReplyToSchemaError(message: string): boolean {
  return /reply_to|reply_to_message_id|42703|42P01|does not exist|schema cache|PGRST/i.test(message)
}

/**
 * PostgREST silently returns at most ~1000 rows per request.
 * Ordering oldest-first therefore drops the newest messages in long threads
 * (list previews still look correct because they use a distinct-on RPC).
 * Always load the newest page, then reverse for chronological chat UI.
 */
export const THREAD_MESSAGE_PAGE_SIZE = 1000

const REPLY_PARENT_SELECT_STAFF =
  `id, sender_id, body, image_url, profiles ( ${STAFF_REPLY_PROFILE} )` as const
const REPLY_PARENT_SELECT_CUSTOMER =
  `id, sender_id, body, image_url, profiles ( ${CUSTOMER_REPLY_PROFILE} )` as const

/** Load quoted parents that sit outside the newest message page. */
async function fetchMissingReplyParents<T extends CustomerMessageRow>(
  client: SupabaseBrowserClient,
  rows: T[],
  profileKind: 'staff' | 'customer'
): Promise<T[]> {
  const have = new Set(rows.map((r) => r.id))
  const missingIds = [
    ...new Set(
      rows
        .map((m) => m.reply_to_message_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && !have.has(id))
    ),
  ]
  if (missingIds.length === 0) return hydrateReplyEmbeds(rows)

  const select = profileKind === 'staff' ? REPLY_PARENT_SELECT_STAFF : REPLY_PARENT_SELECT_CUSTOMER
  const { data, error } = await client.from('messages').select(select).in('id', missingIds)
  if (error || !data?.length) return hydrateReplyEmbeds(rows)

  const parents = new Map(
    (data as MessageReplyEmbed[]).map((p) => [
      p.id,
      {
        id: p.id,
        sender_id: p.sender_id,
        body: p.body,
        image_url: p.image_url ?? null,
        profiles: p.profiles ?? null,
      } satisfies MessageReplyEmbed,
    ])
  )

  return rows.map((m) => {
    if (oneMessageEmbed(m.reply_to)) return m
    const parentId = m.reply_to_message_id
    if (!parentId) return m
    const parent = parents.get(parentId)
    if (!parent) return m
    return { ...m, reply_to: parent }
  })
}

export async function fetchLatestConversationMessages<T extends CustomerMessageRow>(
  client: SupabaseBrowserClient,
  conversationId: string,
  selects: { full: string; legacy: string; base: string },
  opts?: { limit?: number; profileKind?: 'staff' | 'customer' }
): Promise<{ data: T[]; error: { message: string } | null }> {
  const limit = opts?.limit ?? THREAD_MESSAGE_PAGE_SIZE
  const profileKind = opts?.profileKind ?? 'staff'

  async function fetchPage(select: string) {
    const { data, error } = await client
      .from('messages')
      .select(select)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit)
    const rows = ((data || []) as unknown as T[]).slice().reverse()
    return { data: rows, error }
  }

  // Prefer selects without the broken reply_to embed (full === legacy after fix).
  let result = await fetchPage(selects.full)
  if (result.error && isReplyToSchemaError(result.error.message)) {
    result = await fetchPage(selects.legacy)
  }
  if (result.error && isReplyToSchemaError(result.error.message)) {
    result = await fetchPage(selects.base)
  }
  if (!result.error) {
    const withInPage = hydrateReplyEmbeds(result.data)
    const withParents = await fetchMissingReplyParents(client, withInPage, profileKind)
    result = { ...result, data: withParents }
  }
  return result
}

export type CustomerMessageRow = {
  id: string
  sender_id: string
  body: string
  image_url?: string | null
  reply_to_message_id?: string | null
  reply_to?: MessageReplyEmbed | MessageReplyEmbed[] | null
  profiles?: ReplyProfileEmbed | ReplyProfileEmbed[] | null
}

/** Fill reply_to from the same thread when PostgREST embed is missing. */
export function hydrateReplyEmbeds<T extends CustomerMessageRow>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  return rows.map((m) => {
    if (oneMessageEmbed(m.reply_to)) return m
    const parentId = m.reply_to_message_id
    if (!parentId) return m
    const parent = byId.get(parentId)
    if (!parent) return m
    return {
      ...m,
      reply_to: {
        id: parent.id,
        sender_id: parent.sender_id,
        body: parent.body,
        image_url: parent.image_url ?? null,
        profiles: parent.profiles ?? null,
      },
    }
  })
}

export function oneMessageEmbed<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

export function replyPreviewText(body: string | null | undefined, imageUrl?: string | null): string {
  const t = (body ?? '').trim()
  if (t && t !== '📷') return t.length > 120 ? `${t.slice(0, 120)}…` : t
  if (imageUrl) return '📷 Photo'
  return 'Message'
}

export function replyAuthorLabel(
  senderId: string,
  customerId: string,
  embed: ReplyProfileEmbed | null,
  opts?: { businessName?: string; viewerIsCustomer?: boolean }
): string {
  const isCustomer = senderId === customerId
  if (isCustomer) {
    if (opts?.viewerIsCustomer) return 'You'
    const name = [embed?.first_name, embed?.last_name].filter(Boolean).join(' ').trim()
    return name || embed?.username || 'Customer'
  }
  if (opts?.businessName?.trim()) return opts.businessName.trim()
  const name = [embed?.first_name, embed?.last_name].filter(Boolean).join(' ').trim()
  if (name) return name
  if (embed?.username) return `@${embed.username}`
  return 'Team'
}

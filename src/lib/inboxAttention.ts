/** Session-persisted triage queue: threads stay in the Unread filter until explicitly cleared. */

export function inboxAttentionStorageKey(businessId: string): string {
  return `relay-inbox-attention-${businessId}`
}

export function loadInboxAttentionIds(businessId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = sessionStorage.getItem(inboxAttentionStorageKey(businessId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))
  } catch {
    return new Set()
  }
}

export function saveInboxAttentionIds(businessId: string, ids: Iterable<string>): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(inboxAttentionStorageKey(businessId), JSON.stringify([...ids]))
  } catch {
    /* quota / private mode */
  }
}

export function convoNeedsInboxTriage(
  item: { id: string; unreadCount: number },
  attentionIds: ReadonlySet<string>
): boolean {
  return item.unreadCount > 0 || attentionIds.has(item.id)
}

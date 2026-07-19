/**
 * Unread = threads with unread inbound customer messages (unreadCount > 0).
 * Session attention helpers remain for optional triage UX; they do not drive the Unread label.
 */

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

/** True when this thread has unread customer messages staff has not read yet. */
export function convoNeedsInboxTriage(item: { unreadCount: number }): boolean {
  return item.unreadCount > 0
}

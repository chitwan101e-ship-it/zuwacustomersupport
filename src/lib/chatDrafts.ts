const STORAGE_PREFIX = 'relay-chat-draft-v1'

export function omitRecordKey<T>(prev: Record<string, T>, key: string): Record<string, T> {
  if (!(key in prev)) return prev
  const next = { ...prev }
  delete next[key]
  return next
}

function storageKey(userId: string, scope: string, threadId: string) {
  return `${STORAGE_PREFIX}:${userId}:${scope}:${threadId}`
}

/** Saved composer text for one user, keyed by thread id (conversation or business). */
export function readChatDraftMap(userId: string, scope: string): Record<string, string> {
  if (typeof window === 'undefined' || !userId) return {}
  const needle = `${STORAGE_PREFIX}:${userId}:${scope}:`
  const out: Record<string, string> = {}
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith(needle)) continue
      const threadId = key.slice(needle.length)
      if (!threadId) continue
      const value = window.localStorage.getItem(key)
      if (!value || !value.trim()) continue
      out[threadId] = value
    }
  } catch {
    return {}
  }
  return out
}

export function writeChatDraft(userId: string, scope: string, threadId: string, text: string) {
  if (typeof window === 'undefined' || !userId || !threadId) return
  try {
    const key = storageKey(userId, scope, threadId)
    if (!text.trim()) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, text)
  } catch {
    /* quota or private mode */
  }
}

/** One-line list preview. Null when the thread has no unsent text or photo. */
export function draftListLabel(text: string | undefined, hasAttachment = false): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  if (flat) return flat
  if (hasAttachment) return 'Photo'
  return null
}

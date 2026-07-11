'use client'

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

type Options = {
  enabled: boolean
  rootRef: RefObject<HTMLElement | null>
  unreadMessageIds: string[]
  markRead: (messageIds: string[]) => void | Promise<void>
}

/** Mark inbound messages read once they are scrolled into view (IntersectionObserver). */
export function useMarkMessagesReadOnView({
  enabled,
  rootRef,
  unreadMessageIds,
  markRead,
}: Options) {
  const markedRef = useRef(new Set<string>())
  const pendingRef = useRef(new Set<string>())
  const flushTimerRef = useRef<number | null>(null)
  const markReadRef = useRef(markRead)
  markReadRef.current = markRead

  useEffect(() => {
    markedRef.current = new Set()
    pendingRef.current = new Set()
  }, [unreadMessageIds])

  useEffect(() => {
    if (!enabled) return
    const root = rootRef.current
    if (!root) return

    const pendingIds = unreadMessageIds.filter((id) => !markedRef.current.has(id))
    if (pendingIds.length === 0) return

    const flush = () => {
      const ids = [...pendingRef.current]
      pendingRef.current.clear()
      if (ids.length === 0) return
      for (const id of ids) markedRef.current.add(id)
      void markReadRef.current(ids)
    }

    const scheduleFlush = () => {
      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = window.setTimeout(flush, 350)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = (entry.target as HTMLElement).dataset.messageId
          if (!id || markedRef.current.has(id)) continue
          pendingRef.current.add(id)
          scheduleFlush()
        }
      },
      { root, threshold: 0.55, rootMargin: '0px 0px -8% 0px' }
    )

    for (const id of pendingIds) {
      const el = root.querySelector(`[data-message-id="${CSS.escape(id)}"]`)
      if (el) observer.observe(el)
    }

    return () => {
      observer.disconnect()
      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current)
    }
  }, [enabled, rootRef, unreadMessageIds])
}

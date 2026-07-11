'use client'

import { useEffect, useRef } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  showStaffNotificationRowDesktopPopup,
  tryShowStaffInboundMessageDesktopPopup,
} from '@/lib/staffInboundDesktopAlert'
import { isDesktopNotifyEnabled } from '@/lib/desktopNotifications'

type NotificationInsert = {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  conversation_id: string | null
  business_id: string | null
  read: boolean
}

type MessageInsert = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  image_url?: string | null
}

type WatchMessagesOpts = {
  myUserId: string
  businessId: string
  popupTitle: string
  isActivelyViewingThread?: (conversationId: string) => boolean
  getConvoFromList?: (conversationId: string) => { customer_id: string; customerName: string } | undefined
  getSenderLabel?: (msg: MessageInsert) => string | null
}

type UseDesktopMessageNotificationsOpts = {
  supabase: SupabaseClient
  userId: string | undefined
  types: string[]
  onOpenMessage?: (row: NotificationInsert) => void
  onOpenConversation?: (conversationId: string) => void
  watchMessages?: WatchMessagesOpts
  getCustomerLabelForConversation?: (conversationId: string | null) => string | null
}

const POLL_MS = 15_000

/** Listens for new notifications/messages (Realtime + poll fallback) and shows OS corner popups. */
export function useDesktopMessageNotifications({
  supabase,
  userId,
  types,
  onOpenMessage,
  onOpenConversation,
  watchMessages,
  getCustomerLabelForConversation,
}: UseDesktopMessageNotificationsOpts) {
  const typesRef = useRef(types)
  typesRef.current = types
  const onOpenRef = useRef(onOpenMessage)
  onOpenRef.current = onOpenMessage
  const onOpenConvoRef = useRef(onOpenConversation)
  onOpenConvoRef.current = onOpenConversation
  const watchMessagesRef = useRef(watchMessages)
  watchMessagesRef.current = watchMessages
  const getCustomerLabelRef = useRef(getCustomerLabelForConversation)
  getCustomerLabelRef.current = getCustomerLabelForConversation
  const seenNotificationIdsRef = useRef<Set<string>>(new Set())
  const mountedAtRef = useRef<string>(new Date().toISOString())

  useEffect(() => {
    if (!userId) return

    seenNotificationIdsRef.current = new Set()
    mountedAtRef.current = new Date().toISOString()

    async function resolveCustomerLabel(conversationId: string | null): Promise<string | null> {
      const cached = getCustomerLabelRef.current?.(conversationId)
      if (cached) return cached
      if (!conversationId) return null

      const { data: conv } = await supabase
        .from('conversations')
        .select('customer_id')
        .eq('id', conversationId)
        .maybeSingle()
      if (!conv?.customer_id) return null

      const { data: prof } = await supabase
        .from('profiles')
        .select('first_name, username')
        .eq('id', conv.customer_id)
        .maybeSingle()
      return (
        (prof?.first_name as string | null | undefined)?.trim() ||
        (prof?.username as string | null | undefined)?.trim() ||
        null
      )
    }

    async function showNotificationPopup(row: NotificationInsert) {
      if (!isDesktopNotifyEnabled()) return
      if (!typesRef.current.includes(row.type)) return
      if (row.read) return
      if (seenNotificationIdsRef.current.has(row.id)) return
      seenNotificationIdsRef.current.add(row.id)

      const customerLabel =
        row.type === 'support_message' ? await resolveCustomerLabel(row.conversation_id) : null

      showStaffNotificationRowDesktopPopup({
        type: row.type,
        title: row.title,
        body: row.body,
        conversationId: row.conversation_id,
        senderLabel: customerLabel,
        notificationId: row.id,
        onOpen: () => {
          if (row.conversation_id) onOpenConvoRef.current?.(row.conversation_id)
          else onOpenRef.current?.(row)
        },
      })
    }

    void (async () => {
      const { data } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', userId)
        .eq('read', false)
        .in('type', typesRef.current)
      for (const row of data ?? []) {
        seenNotificationIdsRef.current.add((row as { id: string }).id)
      }
    })()

    const channel = supabase.channel(`desktop-notify-${userId}`)

    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        void (async () => {
          const wm = watchMessagesRef.current
          if (!wm || !isDesktopNotifyEnabled()) return
          const msg = payload.new as MessageInsert
          await tryShowStaffInboundMessageDesktopPopup(supabase, msg, {
            businessId: wm.businessId,
            staffUserId: wm.myUserId,
            isActivelyViewingThread: wm.isActivelyViewingThread ?? (() => false),
            getConvoFromList: (id) => wm.getConvoFromList?.(id),
            onOpenConversation: (conversationId) => onOpenConvoRef.current?.(conversationId),
          })
        })()
      }
    )

    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        void showNotificationPopup(payload.new as NotificationInsert)
      }
    )

    channel.subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('[desktop-notify] Realtime subscription failed:', status, err)
      }
    })

    const poll = async () => {
      if (!isDesktopNotifyEnabled()) return
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, link, conversation_id, business_id, read, created_at')
        .eq('user_id', userId)
        .eq('read', false)
        .in('type', typesRef.current)
        .gte('created_at', mountedAtRef.current)
        .order('created_at', { ascending: true })

      if (error) {
        console.warn('[desktop-notify] poll failed:', error.message)
        return
      }

      for (const row of (data ?? []) as NotificationInsert[]) {
        await showNotificationPopup(row)
      }
    }

    const pollTimer = window.setInterval(() => void poll(), POLL_MS)

    return () => {
      window.clearInterval(pollTimer)
      void supabase.removeChannel(channel)
    }
  }, [supabase, userId])
}

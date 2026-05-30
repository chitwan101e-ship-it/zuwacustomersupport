'use client'

import { useEffect, useRef } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { customerMessagePopupTitle, isDesktopNotifyEnabled, messagePreview, showDesktopNotification } from '@/lib/desktopNotifications'

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
  popupTitle: string
  /** Fast check (e.g. not sent by self). */
  isInboundMessage: (msg: MessageInsert) => boolean
  /** Optional: async check that this message belongs to the current user (avoids alerting on other tenants). */
  confirmInbound?: (msg: MessageInsert) => Promise<boolean>
  getSenderLabel?: (msg: MessageInsert) => string | null
}

type UseDesktopMessageNotificationsOpts = {
  supabase: SupabaseClient
  userId: string | undefined
  types: string[]
  onOpenMessage?: (row: NotificationInsert) => void
  onOpenConversation?: (conversationId: string) => void
  /** Prefer messages realtime (works when notifications table is not replicated). */
  watchMessages?: WatchMessagesOpts
  /** Resolve customer first name for support_message notification popups. */
  getCustomerLabelForConversation?: (conversationId: string | null) => string | null
}

/** One popup per inbound message (messages + notifications INSERT often fire together). */
const recentInboundPopups = new Map<string, number>()

function inboundPopupKey(conversationId: string | null, body: string): string {
  return `${conversationId ?? 'none'}:${body.trim().slice(0, 120)}`
}

function shouldShowInboundPopup(conversationId: string | null, body: string): boolean {
  const key = inboundPopupKey(conversationId, body)
  const now = Date.now()
  const prev = recentInboundPopups.get(key)
  if (prev != null && now - prev < 5000) return false
  recentInboundPopups.set(key, now)
  window.setTimeout(() => recentInboundPopups.delete(key), 5000)
  return true
}

/** Listens for new messages / notifications and shows OS corner popups when allowed. */
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

  useEffect(() => {
    if (!userId) return

    const channel = supabase.channel(`desktop-notify-${userId}`)

    if (watchMessagesRef.current) {
      channel.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          void (async () => {
            if (!isDesktopNotifyEnabled()) return
            const wm = watchMessagesRef.current
            if (!wm) return

            const msg = payload.new as MessageInsert
            if (msg.sender_id === wm.myUserId) return

            // Only alert on true customer → staff messages (not team replies / welcome msgs).
            const inbound = wm.confirmInbound
              ? await wm.confirmInbound(msg)
              : wm.isInboundMessage(msg)
            if (!inbound) return
            const label = wm.getSenderLabel?.(msg)
            const title = customerMessagePopupTitle(label, wm.popupTitle)
            const body = messagePreview(msg.body, Boolean(msg.image_url))
            if (!shouldShowInboundPopup(msg.conversation_id, body)) return

            showDesktopNotification({
              title,
              body,
              tag: `relay-msg-${msg.id}`,
              onClick: () => onOpenConvoRef.current?.(msg.conversation_id),
            })
          })()
        }
      )
    }

    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        void (async () => {
          if (!isDesktopNotifyEnabled()) return
          const row = payload.new as NotificationInsert
          if (!typesRef.current.includes(row.type)) return
          if (row.read) return
          if (row.type === 'support_message') {
            if (!shouldShowInboundPopup(row.conversation_id, row.body)) return
          }

          let customerLabel =
            row.type === 'support_message'
              ? getCustomerLabelRef.current?.(row.conversation_id)
              : null

          if (row.type === 'support_message' && !customerLabel && row.conversation_id) {
            const { data: conv } = await supabase
              .from('conversations')
              .select('customer_id')
              .eq('id', row.conversation_id)
              .maybeSingle()
            if (conv?.customer_id) {
              const { data: prof } = await supabase
                .from('profiles')
                .select('first_name, username')
                .eq('id', conv.customer_id)
                .maybeSingle()
              customerLabel =
                (prof?.first_name as string | null | undefined)?.trim() ||
                (prof?.username as string | null | undefined)?.trim() ||
                null
            }
          }

          const title =
            row.type === 'support_message'
              ? customerMessagePopupTitle(customerLabel, row.title)
              : row.title

          showDesktopNotification({
            title,
            body: row.body,
            tag: `relay-notify-${row.id}`,
            onClick: () => {
              if (row.conversation_id) onOpenConvoRef.current?.(row.conversation_id)
              else onOpenRef.current?.(row)
            },
          })
        })()
      }
    )

    channel.subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, userId])
}

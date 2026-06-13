'use client'

import { useEffect, useRef } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  showStaffInboundDesktopPopup,
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

/** Listens for new notifications and shows OS corner popups when allowed. Message popups are handled on the staff dashboard realtime channel. */
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
        void (async () => {
          if (!isDesktopNotifyEnabled()) return
          const row = payload.new as NotificationInsert
          if (!typesRef.current.includes(row.type)) return
          if (row.read) return

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
        })()
      }
    )

    channel.subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('[desktop-notify] subscription failed:', status, err)
      }
    })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, userId])
}

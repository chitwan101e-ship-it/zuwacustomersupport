import type { SupabaseClient } from '@supabase/supabase-js'
import {
  customerMessagePopupTitle,
  isDesktopNotifyEnabled,
  messagePreview,
  showDesktopNotification,
} from '@/lib/desktopNotifications'

/** One popup per inbound message (messages + notifications INSERT often fire together). */
const recentInboundPopups = new Map<string, number>()

function inboundPopupKey(conversationId: string | null, body: string): string {
  return `${conversationId ?? 'none'}:${body.trim().slice(0, 120)}`
}

export function shouldShowStaffInboundPopup(conversationId: string | null, body: string): boolean {
  const key = inboundPopupKey(conversationId, body)
  const now = Date.now()
  const prev = recentInboundPopups.get(key)
  if (prev != null && now - prev < 5000) return false
  return true
}

function markStaffInboundPopupShown(conversationId: string | null, body: string): void {
  const key = inboundPopupKey(conversationId, body)
  recentInboundPopups.set(key, Date.now())
  window.setTimeout(() => recentInboundPopups.delete(key), 5000)
}

function shouldSuppressInboundPopupForActiveView(isActivelyViewingThread: (conversationId: string) => boolean, conversationId: string): boolean {
  if (typeof document === 'undefined') return isActivelyViewingThread(conversationId)
  return !document.hidden && isActivelyViewingThread(conversationId)
}

export function showStaffInboundDesktopPopup(opts: {
  conversationId: string
  body: string
  hasImage?: boolean
  senderLabel?: string | null
  fallbackTitle?: string
  tag?: string
  onOpen?: () => void
}): void {
  if (!isDesktopNotifyEnabled()) return
  const preview = messagePreview(opts.body, opts.hasImage)
  if (!shouldShowStaffInboundPopup(opts.conversationId, preview)) return

  const shown = showDesktopNotification({
    title: customerMessagePopupTitle(opts.senderLabel, opts.fallbackTitle ?? 'New message'),
    body: preview,
    tag: opts.tag ?? `relay-msg-${opts.conversationId}-${Date.now()}`,
    onClick: opts.onOpen,
  })
  if (shown.ok) markStaffInboundPopupShown(opts.conversationId, preview)
  else console.warn('[desktop-notify] message popup failed:', shown.reason)
}

export function showStaffNotificationRowDesktopPopup(opts: {
  type: string
  title: string
  body: string
  conversationId?: string | null
  senderLabel?: string | null
  notificationId?: string
  onOpen?: () => void
}): void {
  if (!isDesktopNotifyEnabled()) return

  const title =
    opts.type === 'support_message'
      ? customerMessagePopupTitle(opts.senderLabel, opts.title)
      : opts.title

  const body = opts.body
  if (opts.type === 'support_message') {
    if (!shouldShowStaffInboundPopup(opts.conversationId ?? null, body)) return
  }

  const shown = showDesktopNotification({
    title,
    body,
    tag: opts.notificationId ? `relay-notify-${opts.notificationId}` : `relay-notify-${opts.type}`,
    onClick: opts.onOpen,
  })
  if (shown.ok && opts.type === 'support_message') {
    markStaffInboundPopupShown(opts.conversationId ?? null, body)
  } else if (!shown.ok) {
    console.warn('[desktop-notify] notification popup failed:', shown.reason, opts.type)
  }
}

type ConvoListHint = {
  customer_id: string
  customerName: string
}

export async function tryShowStaffInboundMessageDesktopPopup(
  supabase: SupabaseClient,
  msg: {
    id?: string
    conversation_id: string
    sender_id: string
    body?: string | null
    image_url?: string | null
  },
  ctx: {
    businessId: string
    staffUserId: string
    isActivelyViewingThread: (conversationId: string) => boolean
    getConvoFromList: (conversationId: string) => ConvoListHint | undefined
    onOpenConversation?: (conversationId: string) => void
  }
): Promise<void> {
  if (!isDesktopNotifyEnabled()) return
  if (msg.sender_id === ctx.staffUserId) return
  if (shouldSuppressInboundPopupForActiveView(ctx.isActivelyViewingThread, msg.conversation_id)) return

  let senderLabel: string | null = null
  const cached = ctx.getConvoFromList(msg.conversation_id)
  if (cached) {
    if (msg.sender_id !== cached.customer_id) return
    senderLabel = cached.customerName.trim().split(/\s+/)[0] || cached.customerName.trim()
    showStaffInboundDesktopPopup({
      conversationId: msg.conversation_id,
      body: msg.body ?? '',
      hasImage: Boolean(msg.image_url),
      senderLabel,
      tag: msg.id ? `relay-msg-${msg.id}` : undefined,
      onOpen: () => ctx.onOpenConversation?.(msg.conversation_id),
    })
    return
  }

  const { data } = await supabase
      .from('conversations')
      .select('business_id, customer_id')
    .eq('id', msg.conversation_id)
    .maybeSingle()
  if (!data || data.business_id !== ctx.businessId) return
  if (msg.sender_id !== data.customer_id) return

  const { data: prof } = await supabase
    .from('profiles')
    .select('first_name, username')
    .eq('id', data.customer_id)
    .maybeSingle()
  senderLabel =
    (prof?.first_name as string | null | undefined)?.trim() ||
    (prof?.username as string | null | undefined)?.trim() ||
    null

  showStaffInboundDesktopPopup({
    conversationId: msg.conversation_id,
    body: msg.body ?? '',
    hasImage: Boolean(msg.image_url),
    senderLabel,
    tag: msg.id ? `relay-msg-${msg.id}` : undefined,
    onOpen: () => ctx.onOpenConversation?.(msg.conversation_id),
  })
}

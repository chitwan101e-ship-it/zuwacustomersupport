import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSingleCustomerNotificationEmail } from '@/lib/sendBulkCustomerNotificationEmails'

/** Reminder ladder delays from streak start (not from last email). */
export const UNREAD_REMINDER_DELAYS_MS = [
  15 * 60 * 1000, // 1st: 15 minutes
  3 * 60 * 60 * 1000, // 2nd: 3 hours
  24 * 60 * 60 * 1000, // 3rd: next day
] as const

export const UNREAD_REMINDER_MAX_EMAILS = 3

export type UnreadReminderRow = {
  conversation_id: string
  business_id: string
  customer_id: string
  streak_started_at: string
  emails_sent: number
  last_email_sent_at: string | null
  last_preview: string | null
  status: 'active' | 'cancelled' | 'completed'
}

export async function ensureUnreadReminderStreak(
  admin: SupabaseClient,
  conversationId: string,
  preview?: string | null
): Promise<void> {
  const { error } = await admin.rpc('ensure_conversation_unread_reminder', {
    p_conversation_id: conversationId,
    p_preview: preview?.trim()?.slice(0, 160) || null,
  })
  if (error) {
    // Table/RPC may not be migrated yet — don't fail the staff send path.
    console.warn('[unread-reminder] ensure failed:', error.message)
  }
}

export async function cancelUnreadReminderIfClear(
  admin: SupabaseClient,
  conversationId: string
): Promise<void> {
  const { error } = await admin.rpc('cancel_conversation_unread_reminder_if_clear', {
    p_conversation_id: conversationId,
  })
  if (error) {
    console.warn('[unread-reminder] cancel failed:', error.message)
  }
}

function reminderCopy(step: 1 | 2 | 3, brandName: string, preview: string) {
  const brand = brandName.trim() || 'Juwa Bros'
  if (step === 1) {
    return {
      subject: `Reminder: unread message from ${brand}`,
      title: `You have an unread message from ${brand}`,
      body:
        preview ||
        `The team at ${brand} sent you a message. Open Relay to read and reply.`,
    }
  }
  if (step === 2) {
    return {
      subject: `Still unread: message from ${brand}`,
      title: `Your message from ${brand} is still waiting`,
      body:
        preview ||
        `Just a heads-up — you still have an unread message from ${brand}. Tap below to open it.`,
    }
  }
  return {
    subject: `You have an unread text from ${brand}`,
    title: `You have an unread text from ${brand}`,
    body:
      preview ||
      `This is a final reminder that you have an unread message from ${brand}. Open Relay when you can.`,
  }
}

async function conversationStillHasUnreadStaff(
  admin: SupabaseClient,
  conversationId: string,
  customerId: string
): Promise<boolean> {
  const { count, error } = await admin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', customerId)
    .or('read.eq.false,read.is.null')
  if (error) {
    console.warn('[unread-reminder] unread check failed:', error.message)
    return true
  }
  return (count ?? 0) > 0
}

async function latestStaffPreview(
  admin: SupabaseClient,
  conversationId: string,
  customerId: string,
  fallback: string | null
): Promise<string> {
  const { data } = await admin
    .from('messages')
    .select('body, image_url, sender_id')
    .eq('conversation_id', conversationId)
    .neq('sender_id', customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const row = data as { body?: string | null; image_url?: string | null } | null
  const body = (row?.body ?? '').trim()
  if (body && body !== '📷') return body.slice(0, 160)
  if (row?.image_url) return '📷 Photo'
  return (fallback ?? '').trim().slice(0, 160) || 'Open Relay to read your message.'
}

function isDue(row: UnreadReminderRow, now: number): boolean {
  if (row.status !== 'active') return false
  if (row.emails_sent >= UNREAD_REMINDER_MAX_EMAILS) return false
  const started = new Date(row.streak_started_at).getTime()
  if (!Number.isFinite(started)) return false
  const delay = UNREAD_REMINDER_DELAYS_MS[row.emails_sent]
  if (delay == null) return false
  return now >= started + delay
}

export type UnreadReminderCronResult = {
  checked: number
  sent: number
  cancelled: number
  completed: number
  skipped: number
  failed: number
}

/**
 * Process due unread reminder emails. Safe to run every few minutes via cron.
 */
export async function processDueUnreadReminders(
  admin: SupabaseClient,
  opts?: { limit?: number; now?: Date }
): Promise<UnreadReminderCronResult> {
  const limit = opts?.limit ?? 50
  const nowDate = opts?.now ?? new Date()
  const now = nowDate.getTime()

  const result: UnreadReminderCronResult = {
    checked: 0,
    sent: 0,
    cancelled: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
  }

  const { data: rows, error } = await admin
    .from('conversation_unread_reminders')
    .select(
      'conversation_id, business_id, customer_id, streak_started_at, emails_sent, last_email_sent_at, last_preview, status'
    )
    .eq('status', 'active')
    .lt('emails_sent', UNREAD_REMINDER_MAX_EMAILS)
    .order('streak_started_at', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[unread-reminder] list failed:', error.message)
    throw new Error(error.message)
  }

  const due = ((rows || []) as UnreadReminderRow[]).filter((r) => isDue(r, now)).slice(0, limit)
  result.checked = due.length

  const brandCache = new Map<string, string>()

  for (const row of due) {
    const stillUnread = await conversationStillHasUnreadStaff(
      admin,
      row.conversation_id,
      row.customer_id
    )
    if (!stillUnread) {
      await cancelUnreadReminderIfClear(admin, row.conversation_id)
      result.cancelled += 1
      continue
    }

    let brandName = brandCache.get(row.business_id)
    if (!brandName) {
      const { data: biz } = await admin
        .from('businesses')
        .select('name')
        .eq('id', row.business_id)
        .maybeSingle()
      brandName = (biz as { name?: string } | null)?.name?.trim() || 'Juwa Bros'
      brandCache.set(row.business_id, brandName)
    }

    const step = (row.emails_sent + 1) as 1 | 2 | 3
    const preview = await latestStaffPreview(
      admin,
      row.conversation_id,
      row.customer_id,
      row.last_preview
    )
    const copy = reminderCopy(step, brandName, preview)

    const emailStatus = await sendSingleCustomerNotificationEmail(admin, {
      userId: row.customer_id,
      subject: copy.subject,
      title: copy.title,
      body: copy.body,
      linkPath: '/feed?openChat=1',
      ctaLabel: 'Open message',
      brandName,
    })

    if (emailStatus === 'failed') {
      result.failed += 1
      continue
    }
    if (emailStatus === 'skipped') {
      result.skipped += 1
      // Still advance so we don't retry forever for users without email.
    } else {
      result.sent += 1
    }

    const nextCount = row.emails_sent + 1
    const completed = nextCount >= UNREAD_REMINDER_MAX_EMAILS
    const { error: updErr } = await admin
      .from('conversation_unread_reminders')
      .update({
        emails_sent: nextCount,
        last_email_sent_at: nowDate.toISOString(),
        last_preview: preview,
        status: completed ? 'completed' : 'active',
        updated_at: nowDate.toISOString(),
      })
      .eq('conversation_id', row.conversation_id)
      .eq('status', 'active')
      .eq('emails_sent', row.emails_sent)

    if (updErr) {
      console.error('[unread-reminder] update failed:', updErr.message)
      result.failed += 1
      continue
    }
    if (completed) result.completed += 1

    // Soft in-app ping on reminder emails (optional signal in notifications list).
    const { error: nErr } = await admin.from('notifications').insert({
      user_id: row.customer_id,
      business_id: row.business_id,
      type: 'support_reply_reminder',
      title: copy.title,
      body: preview.slice(0, 160),
      link: '/feed',
      conversation_id: row.conversation_id,
    })
    if (nErr) console.warn('[unread-reminder] notification insert:', nErr.message)
  }

  return result
}

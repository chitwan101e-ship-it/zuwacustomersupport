import type { SupabaseClient } from '@supabase/supabase-js'
import { renderCustomerNotificationEmailHtml } from '@/lib/emailHtml'
import { getPublicSiteUrl } from '@/lib/publicSiteUrl'
import { getResend, getResendFromAddress } from '@/lib/resend'
import { isSyntheticStaffAuthEmail } from '@/lib/staffAuthEmail'

/** Look up emails in small parallel batches. */
const EMAIL_LOOKUP_BATCH = 8
/** Pause between each Resend send to avoid 429 rate limits. */
const SEND_DELAY_MS = 600
const MAX_SEND_RETRIES = 4

export type BulkNotificationEmailResult = {
  sent: number
  skipped: number
  failed: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { statusCode?: number; message?: string }
  return e.statusCode === 429 || /rate limit|too many requests/i.test(String(e.message ?? ''))
}

async function sendEmailWithRetry(
  resend: NonNullable<ReturnType<typeof getResend>>,
  payload: { from: string; to: string; subject: string; html: string }
): Promise<'sent' | 'failed'> {
  for (let attempt = 0; attempt < MAX_SEND_RETRIES; attempt++) {
    const { error } = await resend.emails.send(payload)
    if (!error) return 'sent'
    if (isRateLimitError(error) && attempt < MAX_SEND_RETRIES - 1) {
      await sleep(SEND_DELAY_MS * (attempt + 2))
      continue
    }
    console.error('[bulk-notification-email]', payload.to, error)
    return 'failed'
  }
  return 'failed'
}

export async function lookupCustomerEmail(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data.user?.email) return null
    const email = data.user.email.trim().toLowerCase()
    if (!email.includes('@') || isSyntheticStaffAuthEmail(email)) return null
    return email
  } catch {
    return null
  }
}

/**
 * Sends the same notification email to many customers (feed post, announcement, alert, update).
 * Failures on individual sends are logged; the batch continues.
 */
export async function sendBulkCustomerNotificationEmails(
  admin: SupabaseClient,
  opts: {
    userIds: string[]
    subject: string
    title: string
    body: string
    linkPath: string
    ctaLabel?: string
    brandName?: string
  }
): Promise<BulkNotificationEmailResult> {
  const resend = getResend()
  if (!resend) {
    console.warn('[bulk-notification-email] RESEND_API_KEY not set — skipping emails')
    return { sent: 0, skipped: opts.userIds.length, failed: 0 }
  }

  const uniqueIds = [...new Set(opts.userIds.filter(Boolean))]
  const brandName = opts.brandName?.trim() || 'Juwa Bros'
  const ctaLabel = opts.ctaLabel?.trim() || 'Open in Relay'
  const linkPath = opts.linkPath.startsWith('/') ? opts.linkPath : `/${opts.linkPath}`
  const linkUrl = `${getPublicSiteUrl()}${linkPath}`
  const html = renderCustomerNotificationEmailHtml({
    brandName,
    title: opts.title,
    body: opts.body,
    ctaLabel,
    linkUrl,
  })

  let sent = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < uniqueIds.length; i += EMAIL_LOOKUP_BATCH) {
    const slice = uniqueIds.slice(i, i + EMAIL_LOOKUP_BATCH)
    const emails = await Promise.all(
      slice.map(async (userId) => ({ userId, email: await lookupCustomerEmail(admin, userId) }))
    )

    for (const row of emails) {
      if (!row.email) {
        skipped += 1
        continue
      }

      const result = await sendEmailWithRetry(resend, {
        from: getResendFromAddress(),
        to: row.email,
        subject: opts.subject,
        html,
      })

      if (result === 'sent') sent += 1
      else failed += 1

      await sleep(SEND_DELAY_MS)
    }
  }

  return { sent, skipped, failed }
}

/** One customer — e.g. when staff sends a support reply (works on phone via the mail app). */
export async function sendSingleCustomerNotificationEmail(
  admin: SupabaseClient,
  opts: {
    userId: string
    subject: string
    title: string
    body: string
    linkPath: string
    ctaLabel?: string
    brandName?: string
  }
): Promise<'sent' | 'skipped' | 'failed'> {
  const resend = getResend()
  if (!resend) {
    console.warn('[customer-notification-email] RESEND_API_KEY not set — skipping')
    return 'skipped'
  }

  const email = await lookupCustomerEmail(admin, opts.userId)
  if (!email) return 'skipped'

  const brandName = opts.brandName?.trim() || 'Juwa Bros'
  const ctaLabel = opts.ctaLabel?.trim() || 'Open message'
  const linkPath = opts.linkPath.startsWith('/') ? opts.linkPath : `/${opts.linkPath}`
  const linkUrl = `${getPublicSiteUrl()}${linkPath}`
  const html = renderCustomerNotificationEmailHtml({
    brandName,
    title: opts.title,
    body: opts.body,
    ctaLabel,
    linkUrl,
  })

  const { error } = await resend.emails.send({
    from: getResendFromAddress(),
    to: email,
    subject: opts.subject,
    html,
  })

  if (error) {
    console.error('[customer-notification-email]', opts.userId, error)
    return 'failed'
  }
  return 'sent'
}

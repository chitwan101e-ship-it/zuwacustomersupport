import type { SupabaseClient } from '@supabase/supabase-js'
import { renderCustomerNotificationEmailHtml } from '@/lib/emailHtml'
import { getPublicSiteUrl } from '@/lib/publicSiteUrl'
import { getResend, getResendFromAddress } from '@/lib/resend'
import { isSyntheticStaffAuthEmail } from '@/lib/staffAuthEmail'

const EMAIL_LOOKUP_BATCH = 8

export type BulkNotificationEmailResult = {
  sent: number
  skipped: number
  failed: number
}

async function lookupCustomerEmail(
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

      const { error } = await resend.emails.send({
        from: getResendFromAddress(),
        to: row.email,
        subject: opts.subject,
        html,
      })

      if (error) {
        console.error('[bulk-notification-email]', row.userId, error)
        failed += 1
      } else {
        sent += 1
      }
    }
  }

  return { sent, skipped, failed }
}

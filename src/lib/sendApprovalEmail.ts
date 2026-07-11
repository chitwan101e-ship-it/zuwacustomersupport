import { escapeHtml } from '@/lib/emailHtml'
import { renderApprovalWelcomeMessage } from '@/lib/approvalWelcomeMessage'
import { getPublicSiteUrl } from '@/lib/publicSiteUrl'
import { getResend, getResendFromAddress } from '@/lib/resend'
import { isSyntheticStaffAuthEmail } from '@/lib/staffAuthEmail'

/**
 * Sends the account-approved email via Resend (same provider as signup OTP).
 * Logs and returns quietly on failure so approval is not blocked.
 */
export async function sendAccountApprovedEmail(opts: {
  to: string
  customerName: string
  username: string
  businessName: string
}): Promise<void> {
  const to = opts.to.trim().toLowerCase()
  if (!to || !to.includes('@') || isSyntheticStaffAuthEmail(to)) return

  const resend = getResend()
  if (!resend) {
    console.warn('[approval-email] RESEND_API_KEY not set — skipping approval email')
    return
  }

  const message = renderApprovalWelcomeMessage({
    customerName: opts.customerName,
    username: opts.username,
    businessName: opts.businessName,
  })

  const loginUrl = `${getPublicSiteUrl()}/login`

  const { error } = await resend.emails.send({
    from: getResendFromAddress(),
    to,
    subject: 'Your Juwa Bros account is approved',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h1 style="font-size: 24px; color: #1a56e8; margin-bottom: 8px;">Juwa Bros</h1>
        <p style="color: #444; margin-bottom: 16px; line-height: 1.5;">${escapeHtml(message)}</p>
        <p style="margin-bottom: 24px;">
          <a href="${loginUrl}" style="display: inline-block; background: #5b21b6; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 10px; font-weight: 600;">Sign in to Relay</a>
        </p>
        <p style="color: #666; font-size: 14px;">You can also open the app and check Support for messages from our team.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 12px;">If you did not sign up for this account, you can ignore this email.</p>
      </div>
    `,
  })

  if (error) console.error('[approval-email]', error)
}

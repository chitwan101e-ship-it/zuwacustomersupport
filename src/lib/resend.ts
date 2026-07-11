import { Resend } from 'resend'

export function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return null
  return new Resend(key)
}

export function getResendFromAddress(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || 'noreply@jbcoms.com'
}

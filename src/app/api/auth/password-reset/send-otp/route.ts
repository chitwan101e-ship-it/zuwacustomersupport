import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getClientIp } from '@/lib/clientIp'
import { rateLimitSendOtp } from '@/lib/authRateLimit'
import { verifyTurnstileToken } from '@/lib/verifyTurnstile'
import { resolveLoginIdentifier } from '@/lib/resolveLoginIdentifier'
import { isSyntheticStaffAuthEmail, normalizeStaffUsername } from '@/lib/staffAuthEmail'

function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY is not configured')
  return new Resend(key)
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function thrownMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

const OK_BODY = { ok: true as const }

export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })
    }

    const body = (await req.json()) as { identifier?: string; turnstileToken?: string }
    const identifier = typeof body.identifier === 'string' ? body.identifier : ''
    const ip = getClientIp(req)

    const captcha = await verifyTurnstileToken(
      typeof body.turnstileToken === 'string' ? body.turnstileToken : undefined,
      ip
    )
    if (!captcha.ok) {
      return NextResponse.json({ error: captcha.error ?? 'Verification failed' }, { status: 400 })
    }

    const trimmed = identifier.trim()
    if (!trimmed) {
      return NextResponse.json({ error: 'Enter your email or @username.' }, { status: 400 })
    }

    const rateEmail = trimmed.includes('@')
      ? trimmed.toLowerCase()
      : `staff:${normalizeStaffUsername(trimmed)}`

    const rl = await rateLimitSendOtp(ip, rateEmail)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many verification requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      )
    }

    const admin = createServiceClient()
    const target = await resolveLoginIdentifier(admin, trimmed)

    if (!target) {
      return NextResponse.json(OK_BODY)
    }

    if (isSyntheticStaffAuthEmail(target.authEmail)) {
      return NextResponse.json(
        {
          error:
            'This account cannot receive email yet. Ask your business admin to add a work email to your profile, or sign in with your work email if you already have one.',
        },
        { status: 400 }
      )
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const hashedOtp = hashToken(otp)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const emailKey = target.authEmail.trim().toLowerCase()

    await admin
      .from('otp_tokens')
      .update({ used: true })
      .eq('email', emailKey)
      .eq('used', false)
      .eq('purpose', 'password_reset')

    const { error: dbError } = await admin.from('otp_tokens').insert({
      email: emailKey,
      token: hashedOtp,
      expires_at: expiresAt,
      used: false,
      purpose: 'password_reset',
    })
    if (dbError) throw dbError

    const { error: emailError } = await getResend().emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@jbcoms.com',
      to: target.authEmail,
      subject: 'Your Relay password reset code',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="font-size: 24px; color: #7c5af6; margin-bottom: 8px;">Relay</h1>
          <p style="color: #444; margin-bottom: 24px;">Use this code to finish resetting your password:</p>
          <div style="background: #f5f3ff; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #5b21b6;">${otp}</span>
          </div>
          <p style="color: #666; font-size: 14px;">Expires in <strong>10 minutes</strong>. If you did not ask for this, you can ignore this email.</p>
        </div>
      `,
    })
    if (emailError) throw emailError

    return NextResponse.json(OK_BODY)
  } catch (err: unknown) {
    const message = thrownMessage(err)
    console.error('[password-reset/send-otp]', err)

    if (message.includes('RESEND_API_KEY is not configured')) {
      return NextResponse.json(
        {
          error: 'Email is not configured for password reset. Set RESEND_API_KEY in the server environment.',
        },
        { status: 500 }
      )
    }

    const lower = message.toLowerCase()
    if (lower.includes('api key is invalid') || lower.includes('invalid api key')) {
      return NextResponse.json(
        {
          error:
            'Resend rejected the API key (invalid or revoked). Update RESEND_API_KEY in the server environment.',
        },
        { status: 500 }
      )
    }

    if (lower.includes('domain') || lower.includes('from')) {
      return NextResponse.json(
        {
          error: 'Email sender is not verified in Resend. Check RESEND_FROM_EMAIL and your verified sending domain.',
        },
        { status: 500 }
      )
    }

    if (lower.includes('relay_auth_user_id_for_email') || lower.includes('schema cache')) {
      return NextResponse.json(
        {
          error:
            'Database is missing the password-reset helper. Apply migration 017_otp_purpose_password_reset.sql in Supabase.',
        },
        { status: 500 }
      )
    }

    if (process.env.NODE_ENV === 'development') {
      return NextResponse.json({ error: `Failed to send code (dev): ${message}` }, { status: 500 })
    }

    return NextResponse.json({ error: 'Failed to send reset code. Please try again.' }, { status: 500 })
  }
}

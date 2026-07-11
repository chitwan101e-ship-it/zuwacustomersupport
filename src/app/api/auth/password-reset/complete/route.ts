import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getClientIp } from '@/lib/clientIp'
import { rateLimitPasswordResetComplete } from '@/lib/authRateLimit'
import { resolveLoginIdentifier } from '@/lib/resolveLoginIdentifier'

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })
    }

    const body = (await req.json()) as { identifier?: string; otp?: string; newPassword?: string }
    const identifier = typeof body.identifier === 'string' ? body.identifier : ''
    const otp = typeof body.otp === 'string' ? body.otp.trim() : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

    if (!identifier.trim() || !otp || !newPassword) {
      return NextResponse.json({ error: 'Identifier, code, and new password are required.' }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    const ip = getClientIp(req)
    const rl = await rateLimitPasswordResetComplete(ip)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      )
    }

    const admin = createServiceClient()
    const target = await resolveLoginIdentifier(admin, identifier)
    if (!target) {
      return NextResponse.json({ error: 'Invalid or expired code.' }, { status: 400 })
    }

    const emailKey = target.authEmail.trim().toLowerCase()
    const hashedOtp = hashToken(otp)

    const { data: tokenRow, error: tokenErr } = await admin
      .from('otp_tokens')
      .select('id')
      .eq('email', emailKey)
      .eq('token', hashedOtp)
      .eq('used', false)
      .eq('purpose', 'password_reset')
      .gte('expires_at', new Date().toISOString())
      .maybeSingle()

    if (tokenErr || !tokenRow) {
      return NextResponse.json({ error: 'Invalid or expired code.' }, { status: 400 })
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(target.userId, {
      password: newPassword,
    })
    if (updErr) {
      const msg = updErr.message?.toLowerCase() ?? ''
      if (msg.includes('password')) {
        return NextResponse.json({ error: updErr.message }, { status: 400 })
      }
      console.error('[password-reset/complete] updateUser', updErr)
      return NextResponse.json({ error: 'Could not update password. Try a different password.' }, { status: 400 })
    }

    await admin
      .from('otp_tokens')
      .update({ used: true })
      .eq('email', emailKey)
      .eq('used', false)
      .eq('purpose', 'password_reset')

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[password-reset/complete]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

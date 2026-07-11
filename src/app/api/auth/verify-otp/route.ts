import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getClientIp } from '@/lib/clientIp'
import { rateLimitVerifyOtp } from '@/lib/authRateLimit'
import { SIGNUP_OTP_VERIFICATION_FAILED } from '@/lib/signupOtp'

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function POST(req: NextRequest) {
  const otpEnabled = process.env.ENABLE_OTP === 'true'
  if (!otpEnabled) {
    return NextResponse.json({ success: true, skipped: true })
  }

  try {
    const body = await req.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const otp = typeof body.otp === 'string' ? body.otp.trim() : ''

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and verification code are required.' }, { status: 400 })
    }

    const ip = getClientIp(req)
    const rl = await rateLimitVerifyOtp(ip, email)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many verification attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      )
    }

    const supabase = createServiceClient()
    const hashedOtp = hashToken(otp)

    const { data: tokenRow, error: tokenErr } = await supabase
      .from('otp_tokens')
      .select('id, verified_at')
      .eq('email', email)
      .eq('token', hashedOtp)
      .eq('used', false)
      .eq('purpose', 'signup')
      .gte('expires_at', new Date().toISOString())
      .maybeSingle()

    if (tokenErr || !tokenRow) {
      return NextResponse.json({ error: SIGNUP_OTP_VERIFICATION_FAILED }, { status: 400 })
    }

    if (!tokenRow.verified_at) {
      const { error: markErr } = await supabase
        .from('otp_tokens')
        .update({ verified_at: new Date().toISOString() })
        .eq('id', tokenRow.id)
        .eq('used', false)
        .is('verified_at', null)

      if (markErr) {
        console.error('[verify-otp] mark verified:', markErr)
        return NextResponse.json({ error: 'Could not verify the code. Please try again.' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('[verify-otp]', err)
    return NextResponse.json({ error: 'Could not verify the code. Please try again.' }, { status: 500 })
  }
}

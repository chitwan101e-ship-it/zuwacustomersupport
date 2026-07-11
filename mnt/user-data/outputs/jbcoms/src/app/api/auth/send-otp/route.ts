// src/app/api/auth/send-otp/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase/server'
import crypto from 'crypto'

const resend = new Resend(process.env.RESEND_API_KEY)

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const hashedOtp = hashToken(otp)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min

    const supabase = createServiceClient()

    // Invalidate previous tokens for this email
    await supabase
      .from('otp_tokens')
      .update({ used: true })
      .eq('email', email)
      .eq('used', false)

    // Store hashed OTP
    const { error: dbError } = await supabase.from('otp_tokens').insert({
      email,
      token: hashedOtp,
      expires_at: expiresAt,
      used: false,
    })
    if (dbError) throw dbError

    // Send email via Resend
    const { error: emailError } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@jbcoms.com',
      to: email,
      subject: 'Your JBComs verification code',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="font-size: 24px; color: #1a56e8; margin-bottom: 8px;">JBComs</h1>
          <p style="color: #444; margin-bottom: 24px;">Your email verification code:</p>
          <div style="background: #f0f5ff; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #1344cc;">${otp}</span>
          </div>
          <p style="color: #666; font-size: 14px;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #aaa; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    })
    if (emailError) throw emailError

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('[send-otp]', err)
    return NextResponse.json({ error: 'Failed to send OTP' }, { status: 500 })
  }
}

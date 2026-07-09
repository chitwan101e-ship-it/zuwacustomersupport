// src/app/api/auth/register/route.ts
import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhoneForDedup } from '@/lib/phoneNormalize'
import { notifyEveryBusinessAdmin } from '@/lib/notifyStaffAdmins'
import { getClientIp } from '@/lib/clientIp'
import { rateLimitRegister } from '@/lib/authRateLimit'
import { verifyTurnstileToken } from '@/lib/verifyTurnstile'
import { SIGNUP_OTP_VERIFICATION_FAILED } from '@/lib/signupOtp'
import { isAuthEmailTakenError, resolveSignupEmailConflict } from '@/lib/authEmailTaken'
import {
  completeCustomerApproval,
  isAutoApproveSignupsEnabled,
  resolveBusinessForNewCustomerSignup,
} from '@/lib/signupApproval'
import crypto from 'crypto'

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function cleanReferralUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/^@+/, '').toLowerCase()
  if (!s) return null
  return s.slice(0, 30)
}

function cleanSignupQuestion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/\s+/g, ' ')
  if (!s) return null
  return s.slice(0, 500)
}

/** Run welcome/notification work after the HTTP response to shorten signup under DB load. */
function deferRegisterFollowUp(task: () => Promise<void>) {
  after(() => {
    void task().catch((err) => console.error('[register] deferred follow-up:', err))
  })
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req)
    const rl = await rateLimitRegister(ip)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many signup attempts from this network. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rl.retryAfterSec) },
        }
      )
    }

    const otpEnabled = process.env.ENABLE_OTP === 'true'
    const body = await req.json()
    const {
      email,
      password,
      otp,
      firstName,
      lastName,
      username,
      phone,
      referralUsername,
      signupQuestion,
      turnstileToken,
    } = body

    // If OTP is enabled, users were already challenged at send-otp step.
    // Keep Turnstile required here only for non-OTP flows.
    if (!otpEnabled) {
      const captcha = await verifyTurnstileToken(
        typeof turnstileToken === 'string' ? turnstileToken : undefined,
        ip
      )
      if (!captcha.ok) {
        return NextResponse.json({ error: captcha.error ?? 'Verification failed' }, { status: 400 })
      }
    }

    if (!email || !password || !firstName || !lastName || !username || !phone) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (otpEnabled && !otp) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const phoneNorm = normalizePhoneForDedup(String(phone))
    if (!phoneNorm) {
      return NextResponse.json(
        { error: 'Enter a full phone number with country code (digits only after normalization).' },
        { status: 400 }
      )
    }

    const referral = cleanReferralUsername(referralUsername)
    const question = cleanSignupQuestion(signupQuestion)
    const supabase = createServiceClient()
    const clientIp = ip !== 'unknown' ? ip : null
    const userAgent = req.headers.get('user-agent') || null

    const logAttempt = async (blocked: boolean, blockReason: string | null) => {
      const { error } = await supabase.from('signup_phone_attempts').insert({
        phone_normalized: phoneNorm,
        attempted_email: String(email).toLowerCase(),
        attempted_username: String(username).replace(/^@/, ''),
        blocked,
        block_reason: blockReason,
        client_ip: clientIp,
        user_agent: userAgent,
      })
      if (error && error.code !== '42P01') console.error('[register] signup_phone_attempts:', error.message)
    }

    // ── 1. Verify OTP (optional via env flag) ────────────────────────────────
    if (otpEnabled) {
      const emailKey = String(email).trim().toLowerCase()
      const hashedOtp = hashToken(otp as string)
      const { data: tokenRow, error: tokenErr } = await supabase
        .from('otp_tokens')
        .select('id')
        .eq('email', emailKey)
        .eq('token', hashedOtp)
        .eq('used', false)
        .eq('purpose', 'signup')
        .not('verified_at', 'is', null)
        .gte('expires_at', new Date().toISOString())
        .maybeSingle()

      if (tokenErr || !tokenRow) {
        return NextResponse.json({ error: SIGNUP_OTP_VERIFICATION_FAILED }, { status: 400 })
      }

      await supabase.from('otp_tokens').update({ used: true }).eq('id', tokenRow.id)
    }

    // ── 2. Check username uniqueness ───────────────────────────────────────────
    const cleanUsername = String(username).replace(/^@/, '')
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', cleanUsername)
      .maybeSingle()

    if (existingUser) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 400 })
    }

    // ── 3. Block duplicate phone (pending / active / suspended / blocked) ─────
    const { data: phoneOwner } = await supabase
      .from('profiles')
      .select('id, username, account_status')
      .eq('phone_normalized', phoneNorm)
      .is('deleted_at', null)
      .in('account_status', ['pending', 'approved', 'suspended', 'blocked'])
      .maybeSingle()

    if (phoneOwner) {
      await logAttempt(true, 'duplicate_phone')
      deferRegisterFollowUp(() =>
        notifyEveryBusinessAdmin(supabase, {
          title: 'Signup blocked: duplicate phone',
          body: `Someone tried to register with a phone number already on file (@${phoneOwner.username}, status ${phoneOwner.account_status}). New attempt: email ${String(email).toLowerCase()}, username @${cleanUsername}.`,
          link: '/notifications',
        })
      )

      return NextResponse.json(
        { error: 'An account with this phone number already exists or is pending approval.' },
        { status: 400 }
      )
    }

    // ── 4. Create Supabase auth user (self-serve customers only) ───────────────
    const createAuthUser = () =>
      supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: otpEnabled,
      })

    let { data: authData, error: authErr } = await createAuthUser()

    if (authErr || !authData?.user) {
      if (isAuthEmailTakenError(authErr ?? null)) {
        const conflict = await resolveSignupEmailConflict(supabase, String(email))
        if (conflict.action === 'reclaimed') {
          ;({ data: authData, error: authErr } = await createAuthUser())
        } else {
          await logAttempt(true, conflict.blockReason)
          return NextResponse.json({ error: conflict.error }, { status: 400 })
        }
      }
      if (authErr || !authData?.user) {
        throw authErr ?? new Error('Failed to create auth user')
      }
    }

    const userId = authData.user.id

    const { error: profileErr } = await supabase.from('profiles').insert({
      id: userId,
      username: cleanUsername,
      first_name: firstName,
      last_name: lastName,
      phone: String(phone).trim(),
      phone_normalized: phoneNorm,
      referral_username: referral,
      signup_question: question,
      role: 'customer',
      business_id: null,
      business_role: null,
      account_status: isAutoApproveSignupsEnabled() ? 'approved' : 'pending',
      email_verified: otpEnabled,
    })

    if (profileErr) {
      await supabase.auth.admin.deleteUser(userId)
      if (profileErr.code === '23505') {
        await logAttempt(true, 'unique_race')
        return NextResponse.json(
          { error: 'That username or phone number was just taken. Please try again.' },
          { status: 400 }
        )
      }
      console.error('[register] profile insert', profileErr)
      throw profileErr
    }

    await logAttempt(false, null)

    const autoApproved = isAutoApproveSignupsEnabled()
    const customerName = `${firstName} ${lastName}`.trim() || cleanUsername
    const emailNorm = String(email).trim().toLowerCase()
    const phoneDisplay = String(phone).trim()
    const referralSuffix = referral ? ` — referral: @${referral}` : ''
    const questionSuffix = question
      ? ` — question: "${question.slice(0, 120)}${question.length > 120 ? '…' : ''}"`
      : ''

    if (autoApproved) {
      const userIdForApproval = userId
      const customerNameForApproval = customerName
      const cleanUsernameForApproval = cleanUsername
      const emailNormForApproval = emailNorm
      deferRegisterFollowUp(async () => {
        const target = await resolveBusinessForNewCustomerSignup(supabase)
        if (!target) {
          console.error(
            '[register] auto-approve: no business with staff found — welcome DM and follow skipped. Set PRIMARY_SUPPORT_BUSINESS_SLUG=juwa-bros in env.'
          )
          return
        }
        try {
          await completeCustomerApproval(supabase, {
            customerId: userIdForApproval,
            customerName: customerNameForApproval,
            username: cleanUsernameForApproval,
            email: emailNormForApproval,
            businessId: target.id,
            businessName: target.name,
            staffSenderId: target.staffSenderId,
          })
        } catch (err) {
          console.error('[register] completeCustomerApproval:', err)
        }
      })
    }

    deferRegisterFollowUp(async () => {
      if (autoApproved) {
        await notifyEveryBusinessAdmin(supabase, {
          title: 'New customer signed up',
          body: `@${cleanUsername} (${customerName}) — phone: ${phoneDisplay}${referralSuffix}${questionSuffix}. Account was approved automatically.`,
          link: '/notifications',
        })
        return
      }

      await notifyEveryBusinessAdmin(supabase, {
        title: 'New customer signup pending',
        body: `@${cleanUsername} (${customerName}) — phone: ${phoneDisplay}${referralSuffix}${questionSuffix}. Review pending accounts in the dashboard.`,
        link: '/notifications',
      })
    })

    return NextResponse.json({
      success: true,
      userId,
      businessId: null,
      subdomain: null,
    })
  } catch (err: unknown) {
    console.error('[register]', err)
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }
}

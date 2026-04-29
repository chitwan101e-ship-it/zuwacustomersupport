// src/app/api/auth/register/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import crypto from 'crypto'

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30)
}

export async function POST(req: NextRequest) {
  try {
    const otpEnabled = process.env.ENABLE_OTP === 'true'
    const body = await req.json()
    const {
      email, password, otp,
      firstName, lastName, username, phone,
      role,
      // business-only
      businessName, businessSlug, businessRole,
    } = body

    if (!email || !password || !firstName || !lastName || !username || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (otpEnabled && !otp) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── 1. Verify OTP (optional via env flag) ────────────────────────────────
    if (otpEnabled) {
      const hashedOtp = hashToken(otp as string)
      const { data: tokenRow, error: tokenErr } = await supabase
        .from('otp_tokens')
        .select('*')
        .eq('email', email)
        .eq('token', hashedOtp)
        .eq('used', false)
        .gte('expires_at', new Date().toISOString())
        .single()

      if (tokenErr || !tokenRow) {
        return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 400 })
      }

      // Mark token used
      await supabase.from('otp_tokens').update({ used: true }).eq('id', tokenRow.id)
    }

    // ── 2. Check username uniqueness ───────────────────────────────────────────
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username.replace(/^@/, ''))
      .single()

    if (existingUser) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 400 })
    }

    // ── 3. Create Supabase auth user ───────────────────────────────────────────
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,  // already verified via OTP
    })

    if (authErr || !authData.user) {
      if (authErr?.message?.includes('already registered')) {
        return NextResponse.json({ error: 'Email already registered' }, { status: 400 })
      }
      throw authErr
    }

    const userId = authData.user.id

    // ── 4. Create business (if business role) ─────────────────────────────────
    let businessId: string | null = null
    if (role === 'business') {
      if (!businessName || !businessRole) {
        return NextResponse.json({ error: 'Business name and role required' }, { status: 400 })
      }

      const finalSlug = businessSlug || slugify(businessName)

      // Check slug availability
      const { data: existingBiz } = await supabase
        .from('businesses')
        .select('id')
        .eq('slug', finalSlug)
        .single()

      if (existingBiz) {
        // Clean up auth user
        await supabase.auth.admin.deleteUser(userId)
        return NextResponse.json({ error: 'Business subdomain already taken' }, { status: 400 })
      }

      // Admin creates business; support agents join an existing one
      if (businessRole === 'admin') {
        const { data: biz, error: bizErr } = await supabase
          .from('businesses')
          .insert({ name: businessName, slug: finalSlug })
          .select()
          .single()

        if (bizErr || !biz) throw bizErr
        businessId = biz.id
      } else {
        // Support agent: find existing business by slug
        const { data: biz } = await supabase
          .from('businesses')
          .select('id')
          .eq('slug', finalSlug)
          .single()

        if (!biz) {
          await supabase.auth.admin.deleteUser(userId)
          return NextResponse.json({ error: 'Business not found. Ask your admin for the correct subdomain.' }, { status: 404 })
        }
        businessId = biz.id

        // Enforce max 4 support agents
        const { count } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('business_id', biz.id)
          .eq('business_role', 'support')

        if ((count ?? 0) >= 4) {
          await supabase.auth.admin.deleteUser(userId)
          return NextResponse.json({ error: 'This business already has 4 support agents.' }, { status: 400 })
        }
      }
    }

    // ── 5. Create profile ──────────────────────────────────────────────────────
    const { error: profileErr } = await supabase.from('profiles').insert({
      id: userId,
      username: username.replace(/^@/, ''),
      first_name: firstName,
      last_name: lastName,
      phone: phone || null,
      role,
      business_id: businessId,
      business_role: role === 'business' ? businessRole : null,
      email_verified: true,
    })

    if (profileErr) {
      await supabase.auth.admin.deleteUser(userId)
      throw profileErr
    }

    return NextResponse.json({
      success: true,
      userId,
      businessId,
      subdomain: role === 'business' ? (businessSlug || slugify(businessName)) : null,
    })
  } catch (err: unknown) {
    console.error('[register]', err)
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }
}

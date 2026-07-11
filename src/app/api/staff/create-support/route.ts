import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isValidStaffUsername, normalizeStaffUsername } from '@/lib/staffAuthEmail'
import { withTimeout } from '@/lib/withTimeout'

export const runtime = 'nodejs'

const MAX_SUPPORT_AGENTS = 4

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 500 })
    }

    const body = (await req.json()) as {
      firstName?: string
      lastName?: string
      email?: string
      username?: string
      password?: string
      confirmPassword?: string
    }

    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : ''
    const lastName =
      typeof body.lastName === 'string' ? body.lastName.trim() : ''
    const emailRaw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const usernameRaw = typeof body.username === 'string' ? body.username : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : ''

    if (!firstName || !emailRaw || !password) {
      return NextResponse.json(
        { error: 'First name, work email, username, and password are required.' },
        { status: 400 }
      )
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Password and confirm password do not match.' }, { status: 400 })
    }

    if (!EMAIL_RE.test(emailRaw)) {
      return NextResponse.json({ error: 'Enter a valid email address for this staff member.' }, { status: 400 })
    }

    if (!isValidStaffUsername(usernameRaw)) {
      return NextResponse.json(
        { error: 'Username must be 3–30 characters: lowercase letters, digits, and underscores only (their public @handle).' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    const username = normalizeStaffUsername(usernameRaw)
    const email = emailRaw

    const supabase = await createClient()
    const {
      data: { user },
      error: sessionErr,
    } = await withTimeout(
      supabase.auth.getUser(),
      15_000,
      'Session check timed out (Supabase did not respond). Try refreshing the page, confirm NEXT_PUBLIC_SUPABASE_URL in .env.local, and check the project is not paused in the Supabase dashboard.'
    )
    if (sessionErr) {
      return NextResponse.json({ error: sessionErr.message }, { status: 401 })
    }
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: adminProf, error: adminErr } = await withTimeout(
      supabase
        .from('profiles')
        .select('id, role, business_role, business_id')
        .eq('id', user.id)
        .single(),
      15_000,
      'Could not load your staff profile (database timed out). Check Supabase status and your network.'
    )

    if (
      adminErr ||
      !adminProf ||
      adminProf.role !== 'business' ||
      adminProf.business_role !== 'admin' ||
      !adminProf.business_id
    ) {
      return NextResponse.json({ error: 'Only business admins can add support staff.' }, { status: 403 })
    }

    const businessId = adminProf.business_id as string
    const admin = createServiceClient()

    const { count: supportCount, error: cErr } = await withTimeout(
      admin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('business_role', 'support')
        .is('deleted_at', null),
      15_000,
      'Support count check timed out. Check Supabase connectivity.'
    )

    if (cErr) {
      return NextResponse.json({ error: cErr.message }, { status: 500 })
    }

    if ((supportCount ?? 0) >= MAX_SUPPORT_AGENTS) {
      return NextResponse.json(
        { error: `This business already has ${MAX_SUPPORT_AGENTS} support agents. Remove someone before adding another.` },
        { status: 400 }
      )
    }

    const { data: taken } = await withTimeout(
      admin.from('profiles').select('id').eq('username', username).maybeSingle(),
      15_000,
      'Username check timed out. Check Supabase connectivity.'
    )
    if (taken) {
      return NextResponse.json({ error: 'That username is already taken. Pick another public @handle.' }, { status: 400 })
    }

    const { data: authData, error: authErr } = await withTimeout(
      admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
      45_000,
      'Supabase Auth did not create the user in time. If this keeps happening, open your Supabase project (Auth) and confirm the URL/key; free-tier projects that are paused often cause long hangs.'
    )

    if (authErr || !authData.user) {
      const msg = (authErr?.message || '').toLowerCase()
      if (msg.includes('already') || msg.includes('registered') || msg.includes('duplicate')) {
        return NextResponse.json(
          { error: 'That email is already registered. Use a different address or remove the old account first.' },
          { status: 400 }
        )
      }
      return NextResponse.json({ error: authErr?.message || 'Could not create account.' }, { status: 500 })
    }

    const userId = authData.user.id

    const { error: insErr } = await withTimeout(
      admin.from('profiles').insert({
        id: userId,
        username,
        first_name: firstName,
        last_name: lastName || '',
        phone: null,
        phone_normalized: null,
        referral_username: null,
        role: 'business',
        business_id: businessId,
        business_role: 'support',
        account_status: 'approved',
        email_verified: true,
      }),
      20_000,
      'Saving the staff profile timed out. Check Supabase connectivity.'
    )

    if (insErr) {
      await admin.auth.admin.deleteUser(userId)
      if (insErr.code === '23505') {
        return NextResponse.json({ error: 'That username was just taken. Try another.' }, { status: 400 })
      }
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      userId,
      username,
      email,
      message: 'Support staff created. They sign in at /login with this email and password (same as you).',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

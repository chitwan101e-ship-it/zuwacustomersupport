import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizeStaffUsername } from '@/lib/staffAuthEmail'

/**
 * Legacy: sign in with staff-only identifier (profile username) + password for accounts created with a synthetic auth email.
 * New support staff use their real email on the normal `signInWithPassword` path.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { staffId?: string; password?: string }
    const staffId = typeof body.staffId === 'string' ? body.staffId : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!staffId.trim() || !password) {
      return NextResponse.json({ error: 'Staff ID and password are required.' }, { status: 400 })
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })
    }

    const username = normalizeStaffUsername(staffId)
    if (!username) {
      return NextResponse.json({ error: 'Invalid username.' }, { status: 400 })
    }

    const admin = createServiceClient()
    const { data: prof, error: pErr } = await admin
      .from('profiles')
      .select('id, role, business_role, account_status, deleted_at')
      .eq('username', username)
      .maybeSingle()

    if (pErr || !prof) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
    }

    if (prof.role !== 'business' || !prof.business_role) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
    }

    if ((prof as { deleted_at?: string | null }).deleted_at) {
      return NextResponse.json({ error: 'This account has been removed.' }, { status: 401 })
    }

    if (prof.account_status !== 'approved') {
      return NextResponse.json({ error: 'This account is not active.' }, { status: 401 })
    }

    const { data: authRes, error: authErr } = await admin.auth.admin.getUserById(prof.id as string)
    if (authErr || !authRes?.user?.email) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
    }

    const email = authRes.user.email

    const res = NextResponse.json({ ok: true })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })
    }

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options as Parameters<typeof res.cookies.set>[2])
          }
        },
      },
    })

    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password })
    if (signErr) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 })
    }

    return res
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

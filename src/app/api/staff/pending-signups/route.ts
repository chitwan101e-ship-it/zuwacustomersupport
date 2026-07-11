import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAutoApproveSignupsEnabled } from '@/lib/signupApproval'
import { withTimeout } from '@/lib/withTimeout'

export const runtime = 'nodejs'

const AUTH_LOOKUP_MS = 12_000
const BATCH = 8

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const countOnly = url.searchParams.get('countOnly') === '1'
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' },
        { status: 500 }
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: sessionErr,
    } = await withTimeout(
      supabase.auth.getUser(),
      15_000,
      'Session check timed out. Try refreshing the page.'
    )
    if (sessionErr) {
      return NextResponse.json({ error: sessionErr.message }, { status: 401 })
    }
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: staff, error: staffErr } = await withTimeout(
      supabase.from('profiles').select('id, role, business_role').eq('id', user.id).single(),
      15_000,
      'Profile check timed out.'
    )

    if (staffErr || !staff || staff.role !== 'business') {
      return NextResponse.json(
        { error: 'Only business staff can view pending signups.' },
        { status: 403 }
      )
    }

    const admin = createServiceClient()

    if (countOnly) {
      const { count, error: countErr } = await withTimeout(
        admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'customer')
          .eq('account_status', 'pending')
          .is('deleted_at', null),
        12_000,
        'Counting pending profiles timed out.'
      )
      if (countErr) {
        return NextResponse.json({ error: countErr.message }, { status: 500 })
      }
      return NextResponse.json({ count: count ?? 0 })
    }

    const { data: profiles, error: profErr } = await withTimeout(
      admin
        .from('profiles')
        .select('id, first_name, last_name, username, phone, referral_username, signup_question, created_at, account_status')
        .eq('role', 'customer')
        .eq('account_status', 'pending')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(80),
      20_000,
      'Listing pending profiles timed out.'
    )

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 })
    }

    const rows = profiles ?? []
    const skipAuthEmailLookup = isAutoApproveSignupsEnabled()
    const enriched: {
      id: string
      first_name: string
      last_name: string
      username: string
      phone: string | null
      referral_username: string | null
      signup_question: string | null
      created_at: string
      account_status: string
      email: string | null
      email_verified: boolean
    }[] = []

    if (skipAuthEmailLookup) {
      for (const p of rows) {
        enriched.push({
          id: p.id as string,
          first_name: (p.first_name as string) ?? '',
          last_name: (p.last_name as string) ?? '',
          username: (p.username as string) ?? '',
          phone: (p.phone as string | null) ?? null,
          referral_username: (p.referral_username as string | null) ?? null,
          signup_question: (p.signup_question as string | null) ?? null,
          created_at: p.created_at as string,
          account_status: p.account_status as string,
          email: null,
          email_verified: false,
        })
      }
      return NextResponse.json({ pending: enriched })
    }

    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH)
      const batch = await Promise.all(
        slice.map(async (p) => {
          let email: string | null = null
          let email_verified = false
          try {
            const { data: authRes } = await withTimeout(
              admin.auth.admin.getUserById(p.id as string),
              AUTH_LOOKUP_MS,
              'auth lookup timeout'
            )
            const u = authRes?.user
            email = u?.email ?? null
            email_verified = !!u?.email_confirmed_at
          } catch {
            // Skip email for this row rather than failing the whole dashboard load.
          }
          return {
            id: p.id as string,
            first_name: (p.first_name as string) ?? '',
            last_name: (p.last_name as string) ?? '',
            username: (p.username as string) ?? '',
            phone: (p.phone as string | null) ?? null,
            referral_username: (p.referral_username as string | null) ?? null,
            signup_question: (p.signup_question as string | null) ?? null,
            created_at: p.created_at as string,
            account_status: p.account_status as string,
            email,
            email_verified,
          }
        })
      )
      enriched.push(...batch)
    }

    return NextResponse.json({ pending: enriched })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

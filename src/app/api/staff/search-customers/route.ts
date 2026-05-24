import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveCustomerRecipient, searchCustomersForNotify } from '@/lib/resolveCustomerRecipient'

async function assertBusinessStaff() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: staff, error: staffErr } = await supabase
    .from('profiles')
    .select('id, role, business_role, business_id')
    .eq('id', user.id)
    .single()

  if (
    staffErr ||
    !staff ||
    staff.role !== 'business' ||
    !staff.business_id ||
    (staff.business_role !== 'admin' && staff.business_role !== 'support')
  ) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { staff, admin: createServiceClient() }
}

export async function GET(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 500 })
    }

    const auth = await assertBusinessStaff()
    if ('error' in auth && auth.error) return auth.error

    const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
    const businessId = auth.staff.business_id as string
    const results = await searchCustomersForNotify(auth.admin, businessId, q)
    return NextResponse.json({ results })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 500 })
    }

    const auth = await assertBusinessStaff()
    if ('error' in auth && auth.error) return auth.error

    const body = (await req.json()) as { identifier?: string }
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : ''
    if (!identifier) {
      return NextResponse.json({ error: 'identifier is required.' }, { status: 400 })
    }

    const customer = await resolveCustomerRecipient(auth.admin, identifier)
    if (!customer) {
      return NextResponse.json({ error: 'No customer found with that username or email.' }, { status: 404 })
    }

    return NextResponse.json({ customer })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

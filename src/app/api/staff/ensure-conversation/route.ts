import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ensureSupportConversation } from '@/lib/ensureSupportConversation'

/** Creates (or returns) a support thread so staff can message an active member first. */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' },
        { status: 500 }
      )
    }

    const body = (await req.json()) as { customerId?: string }
    const customerId = body.customerId?.trim()
    if (!customerId) {
      return NextResponse.json({ error: 'customerId required' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: staff, error: staffErr } = await supabase
      .from('profiles')
      .select('id, role, business_id, business_role')
      .eq('id', user.id)
      .single()

    const businessId = staff?.business_id as string | null
    const okStaff =
      !staffErr &&
      staff &&
      staff.role === 'business' &&
      businessId &&
      (staff.business_role === 'admin' || staff.business_role === 'support')

    if (!okStaff) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admin = createServiceClient()

    const { data: customer, error: custErr } = await admin
      .from('profiles')
      .select('id, role, account_status')
      .eq('id', customerId)
      .single()

    if (custErr || !customer || customer.role !== 'customer' || customer.account_status !== 'approved') {
      return NextResponse.json({ error: 'Customer not found or not approved.' }, { status: 400 })
    }

    const [{ data: follow }, { data: convo }] = await Promise.all([
      admin
        .from('follows')
        .select('user_id')
        .eq('business_id', businessId)
        .eq('user_id', customerId)
        .maybeSingle(),
      admin
        .from('conversations')
        .select('id')
        .eq('business_id', businessId)
        .eq('customer_id', customerId)
        .maybeSingle(),
    ])

    if (!follow && !convo) {
      return NextResponse.json(
        { error: 'This customer must follow your business before you can message them.' },
        { status: 400 }
      )
    }

    const ensured = await ensureSupportConversation(admin, businessId, customerId)
    if ('error' in ensured) {
      return NextResponse.json({ error: ensured.error }, { status: 500 })
    }

    return NextResponse.json({ conversationId: ensured.conversationId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

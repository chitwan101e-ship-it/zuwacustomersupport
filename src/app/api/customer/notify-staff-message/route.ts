import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notifyBusinessStaffOfCustomerMessage } from '@/lib/notifyBusinessStaffOfCustomerMessage'

/**
 * Inserts in-app support_message notifications for all staff when a customer sends a message.
 * Mirrors POST /api/staff/notify-customer-reply — reliable delivery without depending on DB triggers.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { conversationId?: string; preview?: string }
    const conversationId = body.conversationId?.trim()
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' },
        { status: 500 }
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: convo, error: cErr } = await supabase
      .from('conversations')
      .select('id, customer_id, business_id')
      .eq('id', conversationId)
      .single()

    if (cErr || !convo) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    if ((convo.customer_id as string) !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let preview = (body.preview ?? '').trim().slice(0, 160)
    if (!preview) preview = '📷 Message'

    const admin = createServiceClient()
    const { errorMessage } = await notifyBusinessStaffOfCustomerMessage(admin, {
      businessId: convo.business_id as string,
      conversationId: convo.id as string,
      preview,
    })

    if (errorMessage) {
      console.error('[notify-staff-message]', errorMessage)
      return NextResponse.json({ error: errorMessage }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

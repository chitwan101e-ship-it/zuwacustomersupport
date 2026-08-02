import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ensureUnreadReminderStreak } from '@/lib/unreadMessageReminders'

/**
 * Inserts the in-app "support_reply" notification for the customer after staff sends a message.
 * Email is NOT sent here — unread reminder emails go out later (15m / 3h / 24h) via cron
 * only if the customer still has not read the message.
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

    const { data: staff, error: sErr } = await supabase
      .from('profiles')
      .select('id, role, business_id, business_role')
      .eq('id', user.id)
      .single()

    const bid = convo.business_id as string
    const staffBid = staff?.business_id as string | null
    const okStaff =
      !sErr &&
      staff &&
      staff.role === 'business' &&
      staffBid === bid &&
      (staff.business_role === 'admin' || staff.business_role === 'support')

    if (!okStaff) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let preview = (body.preview ?? '').trim().slice(0, 160)
    if (!preview) preview = '📷 Reply'

    const admin = createServiceClient()
    const { error: insErr } = await admin.from('notifications').insert({
      user_id: convo.customer_id,
      business_id: convo.business_id,
      type: 'support_reply',
      title: 'New reply from the team',
      body: preview,
      link: '/feed',
      conversation_id: convo.id,
    })

    if (insErr) {
      console.error('[notify-customer-reply]', insErr)
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    // Start (or keep) unread reminder ladder — emails only if still unread at 15m / 3h / 24h.
    await ensureUnreadReminderStreak(admin, conversationId, preview)

    return NextResponse.json({ ok: true, email: 'deferred_unread_reminders' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

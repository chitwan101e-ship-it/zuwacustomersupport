import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' },
        { status: 500 }
      )
    }

    const body = (await req.json()) as { targetUserId?: string; decision?: string }
    const targetUserId = body.targetUserId
    const decision = body.decision

    if (!targetUserId || !['approve', 'reject', 'block'].includes(decision ?? '')) {
      return NextResponse.json({ error: 'Invalid targetUserId or decision' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: staff, error: staffErr } = await supabase
      .from('profiles')
      .select('id, role, business_role')
      .eq('id', user.id)
      .single()

    if (staffErr || !staff || staff.role !== 'business' || staff.business_role !== 'admin') {
      return NextResponse.json({ error: 'Only business admins can review customer accounts.' }, { status: 403 })
    }

    const admin = createServiceClient()
    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', targetUserId)
      .single()

    if (targetErr || !target || target.role !== 'customer') {
      return NextResponse.json({ error: 'Target must be a customer profile.' }, { status: 400 })
    }

    const nextStatus =
      decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'blocked'

    const { error: updErr } = await admin
      .from('profiles')
      .update({ account_status: nextStatus })
      .eq('id', targetUserId)
      .eq('role', 'customer')

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, account_status: nextStatus })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

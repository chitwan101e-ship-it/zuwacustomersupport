import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notifyBusinessTeamAdmins } from '@/lib/notifyStaffAdmins'

/**
 * Suspend or unsuspend a customer (account_status = suspended | approved).
 * Appends a row to moderation_suspension_events. Business admins and support agents; service role for writes.
 */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 500 })
    }

    const body = (await req.json()) as { targetUserId?: string; action?: string; reason?: string }
    const targetUserId = body.targetUserId
    const action = body.action
    const reason = (body.reason || '').trim() || null

    if (!targetUserId || !['suspend', 'unsuspend'].includes(action ?? '')) {
      return NextResponse.json({ error: 'targetUserId and action (suspend | unsuspend) required' }, { status: 400 })
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
      return NextResponse.json({ error: 'Only business team members can suspend or unsuspend customers.' }, { status: 403 })
    }

    if (user.id === targetUserId) {
      return NextResponse.json({ error: 'Cannot change your own account this way.' }, { status: 400 })
    }

    const admin = createServiceClient()

    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('id, role, account_status, first_name, last_name, username, phone, referral_username')
      .eq('id', targetUserId)
      .single()

    if (targetErr || !target || target.role !== 'customer') {
      return NextResponse.json({ error: 'Target must be a customer profile.' }, { status: 400 })
    }

    const nextStatus = action === 'suspend' ? 'suspended' : 'approved'
    if (action === 'suspend' && target.account_status !== 'approved') {
      return NextResponse.json({ error: 'Only active (approved) customers can be suspended.' }, { status: 400 })
    }
    if (action === 'unsuspend' && target.account_status !== 'suspended') {
      return NextResponse.json({ error: 'Only suspended accounts can be unsuspended.' }, { status: 400 })
    }

    const { error: updErr } = await admin
      .from('profiles')
      .update({ account_status: nextStatus })
      .eq('id', targetUserId)
      .eq('role', 'customer')

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    const { data: authUser } = await admin.auth.admin.getUserById(targetUserId)
    const email = authUser.user?.email ?? '—'
    const t = target as {
      first_name: string
      last_name: string
      username: string
      phone: string | null
      referral_username: string | null
    }
    const name = `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim() || t.username
    const phoneLine = t.phone?.trim() ? `Phone: ${t.phone.trim()}` : 'Phone: —'
    const refLine = t.referral_username ? `Referral: @${t.referral_username}` : 'Referral: —'
    const verb = action === 'suspend' ? 'Suspended' : 'Unsuspended'
    await notifyBusinessTeamAdmins(
      admin,
      staff.business_id as string,
      {
        title: `Customer ${action === 'suspend' ? 'suspended' : 'unsuspended'}`,
        body: `${verb} ${name} (@${t.username}, ${email}). ${phoneLine}. ${refLine}.${reason ? ` Reason: ${reason}` : ''}`,
        link: '/notifications',
      },
      { excludeUserId: user.id }
    )

    const { error: logErr } = await admin.from('moderation_suspension_events').insert({
      profile_id: targetUserId,
      business_id: staff.business_id,
      actor_id: user.id,
      action: action as 'suspend' | 'unsuspend',
      reason,
    })

    if (logErr) {
      return NextResponse.json({ error: `Profile updated but audit log failed: ${logErr.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, account_status: nextStatus })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

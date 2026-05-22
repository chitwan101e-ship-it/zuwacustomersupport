import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendApprovalWelcomeMessage } from '@/lib/approvalWelcomeMessage'
import { notifyBusinessTeamAdmins } from '@/lib/notifyStaffAdmins'
import { sendAccountApprovedEmail } from '@/lib/sendApprovalEmail'

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
      .select('id, role, business_role, business_id')
      .eq('id', user.id)
      .single()

    if (
      staffErr ||
      !staff ||
      staff.role !== 'business' ||
      (staff.business_role !== 'admin' && staff.business_role !== 'support')
    ) {
      return NextResponse.json({ error: 'Only business team members can review customer accounts.' }, { status: 403 })
    }

    const admin = createServiceClient()
    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('id, role, first_name, last_name, username, phone, referral_username')
      .eq('id', targetUserId)
      .single()

    if (targetErr || !target || target.role !== 'customer') {
      return NextResponse.json({ error: 'Target must be a customer profile.' }, { status: 400 })
    }

    const { data: authUser } = await admin.auth.admin.getUserById(targetUserId)
    const email = authUser.user?.email ?? '—'

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

    const t = target as {
      first_name: string
      last_name: string
      username: string
      phone: string | null
      referral_username: string | null
    }
    const name = `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim() || t.username
    const actionWord = decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'Blocked'
    const phoneLine = t.phone?.trim() ? `Phone: ${t.phone.trim()}` : 'Phone: —'
    const refLine = t.referral_username ? `Referral: @${t.referral_username}` : 'Referral: —'
    await notifyBusinessTeamAdmins(
      admin,
      staff.business_id as string,
      {
        title: `Customer ${decision}`,
        body: `${actionWord} ${name} (@${t.username}, ${email}). ${phoneLine}. ${refLine}.`,
        link: '/notifications',
      },
      { excludeUserId: user.id }
    )

    // Approved customers automatically follow this business (feed + messaging without a manual Follow step).
    if (decision === 'approve') {
      const bid = staff.business_id as string | null
      let businessName = 'your team'
      if (bid) {
        const { data: biz } = await admin.from('businesses').select('name').eq('id', bid).maybeSingle()
        if (biz?.name) businessName = biz.name as string

        const { error: fErr } = await admin.from('follows').insert({
          user_id: targetUserId,
          business_id: bid,
        })
        if (fErr && fErr.code !== '23505') {
          console.error('[review-account] follow insert:', fErr)
        }

        const { error: nErr } = await admin.from('notifications').insert({
          user_id: targetUserId,
          business_id: bid,
          type: 'account_approved',
          title: 'Your account is approved',
          body: `You're all set. Open your feed for updates from ${businessName}.`,
          link: '/feed',
        })
        if (nErr) console.error('[review-account] customer notification:', nErr)

        await sendApprovalWelcomeMessage(admin, {
          businessId: bid,
          customerId: targetUserId,
          staffSenderId: user.id,
          customerName: name,
          username: t.username,
          businessName,
        })

        if (email && email !== '—' && email.includes('@')) {
          await sendAccountApprovedEmail({
            to: email,
            customerName: name,
            username: t.username,
            businessName,
          })
        }
      }
    }

    return NextResponse.json({ ok: true, account_status: nextStatus })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

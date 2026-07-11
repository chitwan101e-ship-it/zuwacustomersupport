import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 500 })
    }

    const body = (await req.json()) as { targetUserId?: string }
    const targetUserId = body.targetUserId
    if (!targetUserId || typeof targetUserId !== 'string') {
      return NextResponse.json({ error: 'targetUserId is required.' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: adminProf, error: adminErr } = await supabase
      .from('profiles')
      .select('id, role, business_role, business_id')
      .eq('id', user.id)
      .single()

    if (
      adminErr ||
      !adminProf ||
      adminProf.role !== 'business' ||
      adminProf.business_role !== 'admin' ||
      !adminProf.business_id
    ) {
      return NextResponse.json({ error: 'Only business admins can remove support staff.' }, { status: 403 })
    }

    if (targetUserId === user.id) {
      return NextResponse.json({ error: 'You cannot remove your own admin account this way.' }, { status: 400 })
    }

    const businessId = adminProf.business_id as string
    const admin = createServiceClient()

    const { data: target, error: tErr } = await admin
      .from('profiles')
      .select('id, business_id, business_role, deleted_at')
      .eq('id', targetUserId)
      .single()

    if (tErr || !target) {
      return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 })
    }

    if (target.business_id !== businessId) {
      return NextResponse.json({ error: 'That person is not on your team.' }, { status: 403 })
    }

    if (target.business_role !== 'support') {
      return NextResponse.json({ error: 'Only support agents can be removed here (not other admins).' }, { status: 400 })
    }

    if (target.deleted_at) {
      return NextResponse.json({ ok: true, alreadyRemoved: true })
    }

    const now = new Date().toISOString()
    const { error: updErr } = await admin
      .from('profiles')
      .update({ deleted_at: now })
      .eq('id', targetUserId)
      .eq('business_id', businessId)
      .eq('business_role', 'support')

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    const { error: banErr } = await admin.auth.admin.updateUserById(targetUserId, {
      ban_duration: '876000h',
    })
    if (banErr) {
      console.error('[remove-support] ban user:', banErr)
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

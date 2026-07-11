import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getApprovedCustomerIdsForInboxLabelPresets } from '@/lib/inboxLabelRecipients'
import { sendBulkCustomerNotificationEmails } from '@/lib/sendBulkCustomerNotificationEmails'

const MAX_RECIPIENTS = 10_000

export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' },
        { status: 500 }
      )
    }

    const body = (await req.json()) as {
      userIds?: string[]
      labelPresetKeys?: string[]
      subject?: string
      title?: string
      body?: string
      linkPath?: string
      ctaLabel?: string
      brandName?: string
    }

    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const messageBody = typeof body.body === 'string' ? body.body.trim() : ''
    const linkPath = typeof body.linkPath === 'string' ? body.linkPath.trim() : ''
    const labelPresetKeys = Array.isArray(body.labelPresetKeys)
      ? body.labelPresetKeys.filter((k) => typeof k === 'string' && k.trim())
      : []

    if (!subject || !title || !messageBody || !linkPath) {
      return NextResponse.json(
        { error: 'subject, title, body, and linkPath are required.' },
        { status: 400 }
      )
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
      return NextResponse.json({ error: 'Only business team members can send notification emails.' }, { status: 403 })
    }

    const admin = createServiceClient()
    let userIds: string[]

    if (labelPresetKeys.length > 0) {
      userIds = await getApprovedCustomerIdsForInboxLabelPresets(
        admin,
        staff.business_id as string,
        labelPresetKeys
      )
    } else {
      userIds = Array.isArray(body.userIds) ? body.userIds.filter((id) => typeof id === 'string' && id.trim()) : []
    }

    if (!userIds.length) {
      return NextResponse.json({ ok: true, sent: 0, skipped: 0, failed: 0, recipientCount: 0 })
    }

    if (userIds.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        { error: `Too many recipients (max ${MAX_RECIPIENTS}).` },
        { status: 400 }
      )
    }

    const result = await sendBulkCustomerNotificationEmails(admin, {
      userIds,
      subject,
      title,
      body: messageBody,
      linkPath,
      ctaLabel: body.ctaLabel,
      brandName: body.brandName,
    })

    return NextResponse.json({ ok: true, recipientCount: userIds.length, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

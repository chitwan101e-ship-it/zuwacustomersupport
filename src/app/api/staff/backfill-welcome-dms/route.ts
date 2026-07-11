import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendApprovalWelcomeMessage } from '@/lib/approvalWelcomeMessage'
import { ensureSupportConversation } from '@/lib/ensureSupportConversation'
import { resolveBusinessStaffSenderId } from '@/lib/signupApproval'

const PAGE = 500
const MAX_PER_REQUEST = 200

/**
 * Send missing approval welcome DMs to approved customers (e.g. after a deploy fix).
 * POST body: { limit?: number, sinceHours?: number }
 */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set.' }, { status: 500 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      staff.business_role !== 'admin'
    ) {
      return NextResponse.json({ error: 'Only business admins can backfill welcome DMs.' }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as { limit?: number; sinceHours?: number }
    const limit = Math.min(Math.max(Number(body.limit) || MAX_PER_REQUEST, 1), MAX_PER_REQUEST)
    const sinceHours = Math.max(Number(body.sinceHours) || 48, 1)

    const admin = createServiceClient()
    const businessId = staff.business_id as string
    const staffSenderId = await resolveBusinessStaffSenderId(admin, businessId)
    if (!staffSenderId) {
      return NextResponse.json({ error: 'No staff sender found for this business.' }, { status: 500 })
    }

    const { data: biz } = await admin.from('businesses').select('name').eq('id', businessId).maybeSingle()
    const businessName = (biz?.name as string | undefined) ?? 'Juwa Bros'

    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString()
    const customers: {
      id: string
      username: string
      first_name: string | null
      last_name: string | null
    }[] = []

    let from = 0
    while (customers.length < limit) {
      const { data: rows, error } = await admin
        .from('profiles')
        .select('id, username, first_name, last_name, created_at')
        .eq('role', 'customer')
        .eq('account_status', 'approved')
        .is('deleted_at', null)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!rows?.length) break
      for (const row of rows) {
        customers.push({
          id: row.id as string,
          username: (row.username as string) ?? '',
          first_name: (row.first_name as string | null) ?? null,
          last_name: (row.last_name as string | null) ?? null,
        })
        if (customers.length >= limit) break
      }
      if (rows.length < PAGE) break
      from += PAGE
    }

    let sent = 0
    let skipped = 0
    let failed = 0
    const errors: string[] = []

    for (const c of customers) {
      const customerName = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.username
      const ensured = await ensureSupportConversation(admin, businessId, c.id)
      if ('error' in ensured) {
        failed += 1
        if (errors.length < 5) errors.push(`${c.username}: ${ensured.error}`)
        continue
      }

      const result = await sendApprovalWelcomeMessage(admin, {
        businessId,
        customerId: c.id,
        staffSenderId,
        customerName,
        username: c.username,
        businessName,
        skipIfWelcomeExists: true,
      })

      if (result.sent) sent += 1
      else if (result.reason === 'welcome already sent') skipped += 1
      else {
        failed += 1
        if (errors.length < 5) errors.push(`${c.username}: ${result.reason ?? 'failed'}`)
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: customers.length,
      sent,
      skipped,
      failed,
      errors: errors.length ? errors : undefined,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

import { NextRequest, NextResponse, after } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notifyApprovedCustomersOfAnnouncement } from '@/lib/notifyAnnouncementCustomers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Fan-out runs after the response. Chunked fallback can still touch many customers. */
export const maxDuration = 300

/**
 * Queue in-app notifications for a post that is already on the feed.
 * Returns as soon as the post is verified so the composer is not stuck on Publishing.
 */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' },
        { status: 500 }
      )
    }

    const body = (await req.json()) as { announcementId?: string }
    const announcementId = body.announcementId?.trim()
    if (!announcementId) {
      return NextResponse.json({ error: 'announcementId required' }, { status: 400 })
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
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const businessId = staff.business_id as string
    const { data: announcement, error: aErr } = await supabase
      .from('announcements')
      .select('id, business_id, title, body, deleted_at')
      .eq('id', announcementId)
      .maybeSingle()

    if (aErr || !announcement || announcement.deleted_at || announcement.business_id !== businessId) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    const title = ((announcement.title as string) || '').trim() || 'Update'
    const postBody = (announcement.body as string) || ''

    after(async () => {
      try {
        const admin = createServiceClient()
        await notifyApprovedCustomersOfAnnouncement(admin, {
          businessId,
          announcementId,
          title,
          body: postBody,
        })
      } catch (err) {
        console.error('[notify-announcement] deferred:', err)
      }
    })

    return NextResponse.json({ ok: true, deferred: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

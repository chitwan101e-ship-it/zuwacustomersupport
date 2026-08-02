import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { processDueUnreadReminders } from '@/lib/unreadMessageReminders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Allow enough time for a small batch of Resend sends. */
export const maxDuration = 60

function authorizeCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    // Local/dev convenience when secret is not configured.
    if (process.env.NODE_ENV !== 'production') return true
    return false
  }
  const header = req.headers.get('authorization') || ''
  if (header === `Bearer ${secret}`) return true
  const urlSecret = req.nextUrl.searchParams.get('secret')
  return urlSecret === secret
}

async function handle(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' },
      { status: 500 }
    )
  }

  try {
    const admin = createServiceClient()
    const result = await processDueUnreadReminders(admin)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    console.error('[cron/unread-message-reminders]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** Vercel Cron uses GET; allow POST for manual triggers. */
export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}

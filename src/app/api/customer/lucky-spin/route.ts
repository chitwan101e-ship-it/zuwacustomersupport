import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ensureSupportConversation } from '@/lib/ensureSupportConversation'
import { pickPrimaryBusinessFromList } from '@/lib/signupApproval'
import { customerHasActivePlayerLabel } from '@/lib/inboxLabelRecipients'
import {
  ACTIVE_PLAYER_SPIN_NOTE,
  buildSpinReceiptBody,
  formatLuckyPrize,
  luckySpinResetsAt,
  pickLuckySpinResult,
  RELAY_RECEIPT_HEADER,
} from '@/lib/luckySpin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ProfileRow = {
  role: string
  account_status: string
  deleted_at: string | null
  first_name: string | null
  last_name: string | null
  username: string | null
}

async function requireCustomer() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return {
      error: NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' },
        { status: 500 }
      ),
    }
  }

  const admin = createServiceClient()
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('role, account_status, deleted_at, first_name, last_name, username')
    .eq('id', user.id)
    .maybeSingle()

  const row = profile as ProfileRow | null
  if (profileErr || !row || row.deleted_at) {
    return { error: NextResponse.json({ error: 'Account not found' }, { status: 403 }) }
  }
  if (row.role !== 'customer' || row.account_status !== 'approved') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { admin, userId: user.id, profile: row }
}

async function resolveBusinessId(
  admin: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<string | null> {
  const [{ data: follows, error: followErr }, { data: businesses, error: bizErr }] = await Promise.all([
    admin.from('follows').select('business_id').eq('user_id', userId),
    admin.from('businesses').select('id, name, slug'),
  ])
  if (followErr) throw new Error(followErr.message)
  if (bizErr) throw new Error(bizErr.message)

  const list = (businesses ?? []) as { id: string; name: string; slug: string }[]
  const followedIds = new Set((follows ?? []).map((row) => (row as { business_id: string }).business_id))
  const followed = list.filter((business) => followedIds.has(business.id))
  const picked = pickPrimaryBusinessFromList(followed.length > 0 ? followed : list)
  return picked?.id ?? null
}

function receiptCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let code = 'RL-'
  for (const byte of bytes) code += alphabet[byte % alphabet.length]
  return code
}

type SpinClaim =
  | { ok: true; claimedAt: string; resetsAt: string; previous: string | null }
  | { ok: false; resetsAt: string }

async function readLuckySpinAt(
  admin: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<string | null> {
  const { data, error } = await admin.from('profiles').select('lucky_spin_at').eq('id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  const spunAt = (data as { lucky_spin_at: string | null } | null)?.lucky_spin_at ?? null
  return spunAt
}

/** Starts the 48-hour wait. A second request in the same window loses the row update and is refused. */
async function claimLuckySpin(
  admin: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<SpinClaim> {
  const previous = await readLuckySpinAt(admin, userId)
  const waiting = luckySpinResetsAt(previous)
  if (waiting) return { ok: false, resetsAt: waiting }

  const spunAt = new Date().toISOString()
  let update = admin.from('profiles').update({ lucky_spin_at: spunAt }).eq('id', userId)
  update = previous ? update.eq('lucky_spin_at', previous) : update.is('lucky_spin_at', null)
  const { data, error } = await update.select('lucky_spin_at').maybeSingle()
  if (error) throw new Error(error.message)

  const claimedAt = (data as { lucky_spin_at: string | null } | null)?.lucky_spin_at ?? null
  const resetsAt = luckySpinResetsAt(claimedAt)
  if (claimedAt && resetsAt) return { ok: true, claimedAt, resetsAt, previous }

  const latest = luckySpinResetsAt(await readLuckySpinAt(admin, userId))
  if (latest) return { ok: false, resetsAt: latest }
  throw new Error('The spin did not go through. Try again.')
}

async function releaseLuckySpin(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
  previous: string | null,
  claimedAt: string
) {
  const { error } = await admin
    .from('profiles')
    .update({ lucky_spin_at: previous })
    .eq('id', userId)
    .eq('lucky_spin_at', claimedAt)
  if (error) console.error('[lucky-spin] release claim', error.message)
}

/**
 * One free spin every 48 hours. eligible is false while resetsAt is in the future.
 * The floating wheel still shows. A refresh cannot start another spin.
 */
export async function GET() {
  try {
    const auth = await requireCustomer()
    if ('error' in auth && auth.error) return auth.error
    const { admin, userId } = auth as Exclude<typeof auth, { error: NextResponse }>
    const [activePlayer, spunAt] = await Promise.all([
      customerHasActivePlayerLabel(admin, userId),
      readLuckySpinAt(admin, userId),
    ])
    const resetsAt = luckySpinResetsAt(spunAt)
    return NextResponse.json({ eligible: resetsAt == null, activePlayer, resetsAt })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST() {
  try {
    const auth = await requireCustomer()
    if ('error' in auth && auth.error) return auth.error
    const { admin, userId, profile } = auth as Exclude<typeof auth, { error: NextResponse }>

    if (!(await customerHasActivePlayerLabel(admin, userId))) {
      return NextResponse.json({ code: 'inactive_player', error: ACTIVE_PLAYER_SPIN_NOTE }, { status: 403 })
    }

    const businessId = await resolveBusinessId(admin, userId)
    if (!businessId) {
      return NextResponse.json({ error: 'No team is available for this spin yet.' }, { status: 409 })
    }

    const thread = await ensureSupportConversation(admin, businessId, userId)
    if ('error' in thread) {
      return NextResponse.json({ error: thread.error }, { status: 500 })
    }

    const { data: staffRows, error: staffErr } = await admin
      .from('profiles')
      .select('id, business_role')
      .eq('business_id', businessId)
      .eq('role', 'business')
      .is('deleted_at', null)
    if (staffErr) return NextResponse.json({ error: staffErr.message }, { status: 500 })
    const staff = (staffRows ?? []) as { id: string; business_role: string | null }[]
    const sender = staff.find((row) => row.business_role === 'admin') ?? staff[0]
    if (!sender) {
      return NextResponse.json({ error: 'No agent is available to receive this receipt.' }, { status: 409 })
    }

    const claim = await claimLuckySpin(admin, userId)
    if (!claim.ok) {
      return NextResponse.json(
        { code: 'spin_waiting', error: 'Your next free spin is not ready yet.', resetsAt: claim.resetsAt },
        { status: 403 }
      )
    }

    const result = pickLuckySpinResult()
    if (result.tryAgain) {
      return NextResponse.json({
        tryAgain: true,
        sliceIndex: result.sliceIndex,
        resetsAt: claim.resetsAt,
      })
    }

    const prize = result.prize
    const displayName =
      [profile.first_name, profile.last_name].filter((part) => part?.trim()).join(' ').trim() ||
      profile.username?.trim() ||
      'Customer'
    const username = profile.username?.trim() || 'customer'
    const wonAt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date())
    const receiptId = receiptCode()
    const body = buildSpinReceiptBody({
      receiptId,
      prize,
      customerName: displayName,
      username,
      wonAt,
    })

    const { error: insertErr } = await admin.from('messages').insert({
      conversation_id: thread.conversationId,
      sender_id: sender.id,
      body,
      read: false,
    })
    if (insertErr) {
      await releaseLuckySpin(admin, userId, claim.previous, claim.claimedAt)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    await admin
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', thread.conversationId)

    const prizeLabel = formatLuckyPrize(prize)
    const preview = `${displayName} (@${username}) won ${prizeLabel} credits. ${RELAY_RECEIPT_HEADER}.`
    const { error: staffNoteErr } = await admin.from('notifications').insert(
      staff.map((row) => ({
        user_id: row.id,
        business_id: businessId,
        type: 'support_message',
        title: 'Spin receipt',
        body: preview.slice(0, 160),
        link: '/dashboard',
        conversation_id: thread.conversationId,
        read: false,
      }))
    )
    if (staffNoteErr) console.error('[lucky-spin] staff notify', staffNoteErr.message)

    const { error: customerNoteErr } = await admin.from('notifications').insert({
      user_id: userId,
      business_id: businessId,
      type: 'support_reply',
      title: 'Spin receipt from Relay',
      body: `Relay sent your receipt for ${prizeLabel} credits.`,
      link: '/feed?openChat=1',
      conversation_id: thread.conversationId,
      read: false,
    })
    if (customerNoteErr) console.error('[lucky-spin] customer notify', customerNoteErr.message)

    return NextResponse.json({
      tryAgain: false,
      prize,
      sliceIndex: result.sliceIndex,
      receiptId,
      alreadyClaimed: false,
      notified: !staffNoteErr,
      resetsAt: claim.resetsAt,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { listBusinessApprovedCustomerIds } from '@/lib/resolveCustomerRecipient'

const NOTIFY_CHUNK = 400

type RpcErrorLike = { code?: string; message?: string }

function shouldUseChunkedNotify(error: RpcErrorLike): boolean {
  const code = error.code ?? ''
  const message = (error.message ?? '').toLowerCase()
  if (code === 'PGRST202' || code === '42883' || code === '42501') return true
  if (message.includes('not authorized')) return true
  return (
    message.includes('notify_approved_customers_of_announcement') &&
    (message.includes('could not find') ||
      message.includes('does not exist') ||
      message.includes('schema cache'))
  )
}

/**
 * In-app notifications for a feed post. One SQL statement when migration 041
 * is applied; otherwise chunked inserts. Callers should not block the publish UI on this.
 */
export async function notifyApprovedCustomersOfAnnouncement(
  client: SupabaseClient,
  opts: {
    businessId: string
    announcementId: string
    title: string
    body: string
    /** Browser sessions cannot execute the service-role RPC. */
    skipRpc?: boolean
  }
): Promise<{ notified: number; ok: boolean }> {
  if (!opts.skipRpc) {
    const { error: rpcError, data } = await client.rpc('notify_approved_customers_of_announcement', {
      p_announcement_id: opts.announcementId,
    })

    if (!rpcError) {
      const notified = typeof data === 'number' ? data : Number(data ?? 0)
      return { notified: Number.isFinite(notified) ? notified : 0, ok: true }
    }

    if (!shouldUseChunkedNotify(rpcError)) {
      console.error('[notify-announcement] rpc', rpcError)
      return { notified: 0, ok: false }
    }
  }

  const approvedIds = await listBusinessApprovedCustomerIds(client, opts.businessId)
  const preview = opts.body.length > 120 ? `${opts.body.slice(0, 117)}…` : opts.body
  const rows = approvedIds.map((user_id) => ({
    user_id,
    business_id: opts.businessId,
    type: 'announcement',
    title: `New post: ${opts.title}`,
    body: preview,
    link: `/feed?post=${opts.announcementId}`,
  }))

  for (let i = 0; i < rows.length; i += NOTIFY_CHUNK) {
    const { error } = await client.from('notifications').insert(rows.slice(i, i + NOTIFY_CHUNK))
    if (error) {
      console.error('[notify-announcement]', error)
      return { notified: i, ok: false }
    }
  }

  return { notified: rows.length, ok: true }
}

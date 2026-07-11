import type { SupabaseClient } from '@supabase/supabase-js'

type SupabaseBrowserClient = SupabaseClient

/** Mark specific messages read when they scroll into view (staff or customer). */
export async function markMessagesReadByIds(
  supabase: SupabaseBrowserClient,
  messageIds: string[]
): Promise<{ errorMessage: string | null }> {
  if (messageIds.length === 0) return { errorMessage: null }

  const { error } = await supabase.rpc('mark_messages_read_by_ids', {
    p_message_ids: messageIds,
  })
  if (!error) return { errorMessage: null }

  const msg = error.message || ''
  const missingRpc =
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /does not exist|schema cache|Could not find the function/i.test(msg)

  if (missingRpc) {
    const now = new Date().toISOString()
    const { error: patchErr } = await supabase
      .from('messages')
      .update({ read: true, read_at: now })
      .in('id', messageIds)
      .or('read.eq.false,read.is.null')
    return { errorMessage: patchErr?.message ?? null }
  }

  return { errorMessage: msg }
}

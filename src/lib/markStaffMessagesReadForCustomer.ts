import { createClient } from '@/lib/supabase/client'

type SupabaseBrowserClient = ReturnType<typeof createClient>

export async function markStaffMessagesReadForCustomer(
  supabase: SupabaseBrowserClient,
  conversationId: string
): Promise<{ errorMessage: string | null }> {
  const { error } = await supabase.rpc('mark_staff_messages_read_for_customer', {
    p_conversation_id: conversationId,
  })
  if (!error) return { errorMessage: null }
  const msg = error.message || ''
  const missingRpc =
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /does not exist|schema cache|Could not find the function/i.test(msg)
  if (!missingRpc) return { errorMessage: msg }
  return { errorMessage: 'Run supabase/migrations/011_message_read_at.sql in Supabase SQL Editor.' }
}

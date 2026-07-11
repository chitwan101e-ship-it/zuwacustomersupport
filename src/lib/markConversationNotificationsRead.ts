import { createClient } from '@/lib/supabase/client'

type SupabaseBrowserClient = ReturnType<typeof createClient>

/** Marks in-app notifications tied to a support thread as read for the current user. */
export async function markConversationNotificationsRead(
  supabase: SupabaseBrowserClient,
  userId: string,
  conversationId: string
): Promise<{ errorMessage: string | null }> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .eq('read', false)

  if (error) return { errorMessage: error.message }
  return { errorMessage: null }
}

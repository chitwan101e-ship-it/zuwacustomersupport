import type { SupabaseClient } from '@supabase/supabase-js'

/** Returns an existing support thread id or creates one (service role). */
export async function ensureSupportConversation(
  admin: SupabaseClient,
  businessId: string,
  customerId: string
): Promise<{ conversationId: string } | { error: string }> {
  const { data: existing, error: exErr } = await admin
    .from('conversations')
    .select('id')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .maybeSingle()

  if (exErr) return { error: exErr.message }
  if (existing?.id) return { conversationId: existing.id as string }

  const { data: created, error: crErr } = await admin
    .from('conversations')
    .insert({
      business_id: businessId,
      customer_id: customerId,
      status: 'open',
    })
    .select('id')
    .single()

  if (crErr) return { error: crErr.message }
  return { conversationId: created.id as string }
}

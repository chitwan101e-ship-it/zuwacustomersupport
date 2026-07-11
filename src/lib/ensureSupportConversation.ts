import type { SupabaseClient } from '@supabase/supabase-js'

/** Returns an existing support thread id or creates one (service role). */
export async function ensureSupportConversation(
  admin: SupabaseClient,
  businessId: string,
  customerId: string
): Promise<{ conversationId: string } | { error: string }> {
  const { data: existingRows, error: exErr } = await admin
    .from('conversations')
    .select('id')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: true })
    .limit(5)

  if (exErr) return { error: exErr.message }
  if (existingRows?.length) {
    if (existingRows.length > 1) {
      console.warn(
        '[ensureSupportConversation] multiple threads for business/customer — using oldest',
        businessId,
        customerId
      )
    }
    return { conversationId: existingRows[0].id as string }
  }

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

import type { SupabaseClient } from '@supabase/supabase-js'

/** In-app support_message rows for every staff member on the business team. */
export async function notifyBusinessStaffOfCustomerMessage(
  admin: SupabaseClient,
  opts: {
    businessId: string
    conversationId: string
    preview: string
  }
): Promise<{ errorMessage: string | null }> {
  const preview = opts.preview.trim().slice(0, 160) || '📷 Message'

  const { data: convo, error: convoErr } = await admin
    .from('conversations')
    .select('customer_id')
    .eq('id', opts.conversationId)
    .maybeSingle()

  if (convoErr) return { errorMessage: convoErr.message }

  let popupTitle = 'New customer message'
  if (convo?.customer_id) {
    const { data: customer } = await admin
      .from('profiles')
      .select('first_name, username')
      .eq('id', convo.customer_id)
      .maybeSingle()
    const label =
      (customer?.first_name as string | null | undefined)?.trim() ||
      (customer?.username as string | null | undefined)?.trim() ||
      'Customer'
    popupTitle = `${label} message`
  }

  const { data: staff, error: staffErr } = await admin
    .from('profiles')
    .select('id')
    .eq('business_id', opts.businessId)
    .eq('role', 'business')
    .is('deleted_at', null)

  if (staffErr) return { errorMessage: staffErr.message }
  if (!staff?.length) return { errorMessage: null }

  const { error: insErr } = await admin.from('notifications').insert(
    staff.map((row) => ({
      user_id: row.id as string,
      business_id: opts.businessId,
      type: 'support_message',
      title: popupTitle,
      body: preview,
      link: '/dashboard',
      conversation_id: opts.conversationId,
      read: false,
    }))
  )

  if (insErr) return { errorMessage: insErr.message }
  return { errorMessage: null }
}

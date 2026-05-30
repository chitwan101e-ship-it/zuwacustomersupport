import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureSupportConversation } from '@/lib/ensureSupportConversation'

export const NEWLY_APPROVED_PRESET_KEY = 'newly_approved'

/** Assigns the "Newly approved" inbox label on the support thread (idempotent). */
async function assignNewlyApprovedLabel(
  admin: SupabaseClient,
  businessId: string,
  conversationId: string
): Promise<void> {
  const { data: labelDef, error: defErr } = await admin
    .from('inbox_label_definitions')
    .select('id')
    .eq('business_id', businessId)
    .eq('preset_key', NEWLY_APPROVED_PRESET_KEY)
    .maybeSingle()

  if (defErr) {
    console.error('[approval-welcome] newly_approved label lookup:', defErr.message)
    return
  }
  if (!labelDef?.id) {
    console.error('[approval-welcome] newly_approved label not found for business')
    return
  }

  const { error: insErr } = await admin.from('conversation_inbox_labels').insert({
    conversation_id: conversationId,
    label_id: labelDef.id,
  })
  if (insErr && insErr.code !== '23505') {
    console.error('[approval-welcome] newly_approved label assign:', insErr.message)
  }
}

export const DEFAULT_APPROVAL_WELCOME_TEMPLATE =
  "Welcome, {customer_name}! Your account has been approved. We're glad to have you at Juwa Bros. Message us here anytime if you need help."

export function renderApprovalWelcomeMessage(params: {
  customerName: string
  username: string
  businessName: string
}): string {
  return DEFAULT_APPROVAL_WELCOME_TEMPLATE.replaceAll('{customer_name}', params.customerName)
    .replaceAll('{username}', params.username)
    .replaceAll('{business}', params.businessName)
}

/**
 * Creates a support thread (if needed) and sends the default welcome message when a customer is approved.
 * Errors are logged only — approval should still succeed if messaging fails.
 */
export async function sendApprovalWelcomeMessage(
  admin: SupabaseClient,
  opts: {
    businessId: string
    customerId: string
    staffSenderId: string
    customerName: string
    username: string
    businessName: string
  }
): Promise<void> {
  const { businessId, customerId, staffSenderId, customerName, username, businessName } = opts

  try {
    const ensured = await ensureSupportConversation(admin, businessId, customerId)
    if ('error' in ensured) {
      console.error('[approval-welcome] conversation:', ensured.error)
      return
    }
    const conversationId = ensured.conversationId

    await assignNewlyApprovedLabel(admin, businessId, conversationId)

    const { count, error: countErr } = await admin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
    if (countErr) {
      console.error('[approval-welcome] message count:', countErr.message)
      return
    }
    if ((count ?? 0) > 0) return

    const body = renderApprovalWelcomeMessage({ customerName, username, businessName })
    const preview = body.trim().slice(0, 160)

    const { error: msgErr } = await admin.from('messages').insert({
      conversation_id: conversationId,
      sender_id: staffSenderId,
      body,
    })
    if (msgErr) {
      console.error('[approval-welcome] message insert:', msgErr.message)
      return
    }

    const { error: updErr } = await admin
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)
    if (updErr) console.error('[approval-welcome] conversation update:', updErr.message)

    const { error: nErr } = await admin.from('notifications').insert({
      user_id: customerId,
      business_id: businessId,
      type: 'support_reply',
      title: 'New reply from the team',
      body: preview,
      link: '/feed',
      conversation_id: conversationId,
    })
    if (nErr) console.error('[approval-welcome] customer notification:', nErr.message)
  } catch (e) {
    console.error('[approval-welcome]', e)
  }
}

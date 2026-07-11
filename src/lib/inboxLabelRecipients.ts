import type { SupabaseClient } from '@supabase/supabase-js'

/** Preset keys for inbox labels that receive feed-post notification emails. */
export const FEED_POST_EMAIL_LABEL_PRESETS = ['active_player', 'account_created'] as const

const PRESET_NAME_FALLBACK: Record<string, string> = {
  active_player: 'active player',
  account_created: 'account created',
}

function matchesPreset(
  def: { preset_key: string | null; name: string },
  presetKeys: string[]
): boolean {
  const wanted = new Set(presetKeys.map((k) => k.toLowerCase()))
  if (def.preset_key && wanted.has(def.preset_key.toLowerCase())) return true
  const nameNorm = def.name.trim().toLowerCase()
  for (const key of presetKeys) {
    if (PRESET_NAME_FALLBACK[key.toLowerCase()] === nameNorm) return true
  }
  return false
}

/** Customer ids with any of the given inbox label presets on a support thread for this business. */
export async function getCustomerIdsForInboxLabelPresets(
  admin: SupabaseClient,
  businessId: string,
  presetKeys: string[]
): Promise<string[]> {
  const keys = [...new Set(presetKeys.map((k) => k.trim()).filter(Boolean))]
  if (keys.length === 0) return []

  const { data: defs, error: defErr } = await admin
    .from('inbox_label_definitions')
    .select('id, preset_key, name')
    .eq('business_id', businessId)

  if (defErr) {
    console.error('[inbox-label-recipients] label defs:', defErr.message)
    return []
  }

  const labelIds = (defs || [])
    .filter((d) => matchesPreset(d as { preset_key: string | null; name: string }, keys))
    .map((d) => (d as { id: string }).id)

  if (labelIds.length === 0) return []

  const { data: assignments, error: assignErr } = await admin
    .from('conversation_inbox_labels')
    .select('conversation_id')
    .in('label_id', labelIds)

  if (assignErr) {
    console.error('[inbox-label-recipients] assignments:', assignErr.message)
    return []
  }

  const conversationIds = [...new Set((assignments || []).map((a) => (a as { conversation_id: string }).conversation_id))]
  if (conversationIds.length === 0) return []

  const { data: convos, error: convoErr } = await admin
    .from('conversations')
    .select('customer_id')
    .eq('business_id', businessId)
    .in('id', conversationIds)

  if (convoErr) {
    console.error('[inbox-label-recipients] conversations:', convoErr.message)
    return []
  }

  return [...new Set((convos || []).map((c) => (c as { customer_id: string }).customer_id))]
}

/** Labeled customers who are still approved (eligible for notification email). */
export async function getApprovedCustomerIdsForInboxLabelPresets(
  admin: SupabaseClient,
  businessId: string,
  presetKeys: string[]
): Promise<string[]> {
  const customerIds = await getCustomerIdsForInboxLabelPresets(admin, businessId, presetKeys)
  if (customerIds.length === 0) return []

  const approved = new Set<string>()
  const chunk = 200
  for (let i = 0; i < customerIds.length; i += chunk) {
    const slice = customerIds.slice(i, i + chunk)
    const { data: rows, error } = await admin
      .from('profiles')
      .select('id')
      .in('id', slice)
      .eq('role', 'customer')
      .eq('account_status', 'approved')
      .is('deleted_at', null)
    if (error) {
      console.error('[inbox-label-recipients] profiles:', error.message)
      continue
    }
    for (const r of rows || []) approved.add((r as { id: string }).id)
  }
  return [...approved]
}

import type { SupabaseClient } from '@supabase/supabase-js'

type AdminNotifyPayload = {
  title: string
  body: string
  link?: string | null
}

async function insertStaffNotifications(
  admin: SupabaseClient,
  recipients: { id: string; business_id: string | null }[],
  payload: AdminNotifyPayload
) {
  if (recipients.length === 0) return
  const rows = recipients.map((r) => ({
    user_id: r.id,
    business_id: r.business_id,
    type: 'staff_alert',
    title: payload.title,
    body: payload.body,
    link: payload.link ?? '/notifications',
    read: false,
  }))
  const { error } = await admin.from('notifications').insert(rows)
  if (error) console.error('[insertStaffNotifications]', error.message)
}

/** Every business admin (for platform-wide signup alerts — no business filter). */
export async function notifyEveryBusinessAdmin(admin: SupabaseClient, payload: AdminNotifyPayload) {
  const { data, error } = await admin
    .from('profiles')
    .select('id, business_id')
    .eq('role', 'business')
    .eq('business_role', 'admin')
    .is('deleted_at', null)

  if (error) {
    console.error('[notifyEveryBusinessAdmin]', error.message)
    return
  }
  const recipients = (data || []).map((r) => ({
    id: r.id as string,
    business_id: (r.business_id as string | null) ?? null,
  }))
  await insertStaffNotifications(admin, recipients, payload)
}

/** Admins on the same business team (optionally excluding the acting user). */
export async function notifyBusinessTeamAdmins(
  admin: SupabaseClient,
  businessId: string,
  payload: AdminNotifyPayload,
  options?: { excludeUserId?: string }
) {
  const { data, error } = await admin
    .from('profiles')
    .select('id, business_id')
    .eq('role', 'business')
    .eq('business_role', 'admin')
    .eq('business_id', businessId)
    .is('deleted_at', null)

  if (error) {
    console.error('[notifyBusinessTeamAdmins]', error.message)
    return
  }
  const ex = options?.excludeUserId
  let recipients = (data || [])
    .filter((r) => !ex || (r.id as string) !== ex)
    .map((r) => ({
      id: r.id as string,
      business_id: (r.business_id as string | null) ?? null,
    }))
  if (recipients.length === 0 && ex) {
    const self = (data || []).find((r) => (r.id as string) === ex)
    if (self) {
      recipients = [
        {
          id: self.id as string,
          business_id: (self.business_id as string | null) ?? null,
        },
      ]
    }
  }
  await insertStaffNotifications(admin, recipients, payload)
}

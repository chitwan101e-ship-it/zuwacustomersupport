import type { SupabaseClient } from '@supabase/supabase-js'
import { sendApprovalWelcomeMessage } from '@/lib/approvalWelcomeMessage'
import { sendAccountApprovedEmail } from '@/lib/sendApprovalEmail'

/** Signups are approved automatically unless MANUAL_SIGNUP_APPROVAL=true (server or NEXT_PUBLIC). */
export function isManualSignupApprovalRequired(): boolean {
  const manual =
    process.env.MANUAL_SIGNUP_APPROVAL ?? process.env.NEXT_PUBLIC_MANUAL_SIGNUP_APPROVAL ?? ''
  return manual.trim().toLowerCase() === 'true'
}

export function isAutoApproveSignupsEnabled(): boolean {
  return !isManualSignupApprovalRequired()
}

type BusinessRow = { id: string; name: string; slug: string }

export async function resolvePrimaryBusinessForSignup(
  admin: SupabaseClient
): Promise<{ id: string; name: string } | null> {
  const { data: businesses, error } = await admin.from('businesses').select('id, name, slug')
  if (error) {
    console.error('[signup-approval] businesses lookup:', error.message)
    return null
  }
  const list = (businesses ?? []) as BusinessRow[]
  if (list.length === 0) return null

  const envSlug = process.env.NEXT_PUBLIC_PRIMARY_SUPPORT_BUSINESS_SLUG?.trim()
  if (envSlug) {
    const fromEnv = list.find((b) => b.slug.toLowerCase() === envSlug.toLowerCase())
    if (fromEnv) return { id: fromEnv.id, name: fromEnv.name }
  }

  const slugHints = ['support', 'relay', 'jbcoms', 'admin', 'help']
  for (const s of slugHints) {
    const hit = list.find((b) => b.slug.toLowerCase() === s)
    if (hit) return { id: hit.id, name: hit.name }
  }

  const byName = list.find((b) => /support|helpdesk|help\s*desk|relay\s*support/i.test(b.name))
  if (byName) return { id: byName.id, name: byName.name }

  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name))
  return { id: sorted[0].id, name: sorted[0].name }
}

export async function resolveBusinessAdminStaffId(
  admin: SupabaseClient,
  businessId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'business')
    .eq('business_role', 'admin')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[signup-approval] admin lookup:', error.message)
    return null
  }
  return (data?.id as string | undefined) ?? null
}

export type CompleteCustomerApprovalOpts = {
  customerId: string
  customerName: string
  username: string
  email?: string | null
  businessId: string
  businessName: string
  staffSenderId: string
}

/** Follow business, notify customer, send welcome message + optional approval email. */
export async function completeCustomerApproval(
  admin: SupabaseClient,
  opts: CompleteCustomerApprovalOpts
): Promise<void> {
  const { customerId, customerName, username, email, businessId, businessName, staffSenderId } = opts

  const { error: fErr } = await admin.from('follows').insert({
    user_id: customerId,
    business_id: businessId,
  })
  if (fErr && fErr.code !== '23505') {
    console.error('[signup-approval] follow insert:', fErr.message)
  }

  const { error: nErr } = await admin.from('notifications').insert({
    user_id: customerId,
    business_id: businessId,
    type: 'account_approved',
    title: 'Your account is approved',
    body: `You're all set. Open your feed for updates from ${businessName}.`,
    link: '/feed',
  })
  if (nErr) console.error('[signup-approval] customer notification:', nErr.message)

  await sendApprovalWelcomeMessage(admin, {
    businessId,
    customerId,
    staffSenderId,
    customerName,
    username,
    businessName,
  })

  const to = email?.trim()
  if (to && to.includes('@')) {
    await sendAccountApprovedEmail({
      to,
      customerName,
      username,
      businessName,
    })
  }
}

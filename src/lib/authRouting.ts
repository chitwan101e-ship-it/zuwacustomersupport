import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

type ProfileAuthRow = {
  role: 'customer' | 'business'
  business_role: string | null
  account_status: string
  deleted_at?: string | null
}

/** Where an already-signed-in user should land, or null if they should stay on auth pages. */
export async function resolveAuthenticatedPath(
  supabase: SupabaseClient
): Promise<string | null> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) return null

  const { data: prof, error: pErr } = await supabase
    .from('profiles')
    .select('role, business_role, account_status, deleted_at')
    .eq('id', user.id)
    .single()

  if (pErr || !prof) return null

  const row = prof as ProfileAuthRow
  if (row.deleted_at) return null

  if (row.role === 'customer' && row.account_status === 'suspended') {
    return '/account-suspended'
  }

  if (row.role === 'customer' && row.account_status !== 'approved') {
    return '/pending-approval'
  }

  if (row.account_status !== 'approved') return null

  if (row.role === 'business' && row.business_role) return '/dashboard'
  if (row.role === 'business' && !row.business_role) return null

  return '/feed'
}

/** Send logged-in users away from /login and /signup. Returns true when redirecting. */
export async function redirectIfAuthenticated(
  supabase: SupabaseClient,
  router: AppRouterInstance
): Promise<boolean> {
  const path = await resolveAuthenticatedPath(supabase)
  if (!path) return false
  router.replace(path)
  return true
}

/** Post sign-in routing with explicit errors (signs out when the account cannot proceed). */
export async function finalizeSessionAfterSignIn(
  supabase: SupabaseClient,
  router: AppRouterInstance
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('No user after sign-in')

  const { data: prof, error: pErr } = await supabase
    .from('profiles')
    .select('role, business_role, account_status, deleted_at')
    .eq('id', user.id)
    .single()

  if (pErr || !prof) {
    await supabase.auth.signOut()
    throw new Error(
      'No profile found for this account. If you are staff, your admin should add you from the dashboard. Customers should complete Create Account first.'
    )
  }

  const row = prof as ProfileAuthRow

  if (row.deleted_at) {
    await supabase.auth.signOut()
    throw new Error('This account has been removed.')
  }

  if (row.role === 'customer' && row.account_status === 'suspended') {
    router.replace('/account-suspended')
    return
  }

  if (row.role === 'customer' && row.account_status !== 'approved') {
    router.replace('/pending-approval')
    return
  }

  if (row.account_status !== 'approved') {
    await supabase.auth.signOut()
    throw new Error(
      row.account_status === 'pending'
        ? 'Your staff account is pending approval.'
        : row.account_status === 'rejected'
          ? 'Your access request was rejected.'
          : row.account_status === 'suspended'
            ? 'Your account is suspended. Contact support.'
            : 'Your account is blocked. Contact support.'
    )
  }

  if (row.role === 'business' && row.business_role) {
    router.replace('/dashboard')
    return
  }

  if (row.role === 'business' && !row.business_role) {
    await supabase.auth.signOut()
    throw new Error(
      'Your staff profile is incomplete. Ask your business admin to fix your account or recreate it from the dashboard Team tab.'
    )
  }

  router.replace('/feed')
}

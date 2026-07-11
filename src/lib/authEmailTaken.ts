import type { AuthError } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

export function isAuthEmailTakenError(err: AuthError | null | undefined): boolean {
  if (!err) return false
  const msg = err.message || ''
  return (
    /already|exists|registered|duplicate/i.test(msg) ||
    err.status === 422 ||
    err.code === 'email_exists'
  )
}

export type SignupEmailConflict =
  | { action: 'reclaimed' }
  | { action: 'reject'; error: string; blockReason: string }

/** Remove orphaned or rejected auth users so the email can be used again. */
export async function resolveSignupEmailConflict(
  admin: SupabaseClient,
  email: string
): Promise<SignupEmailConflict> {
  const emailKey = email.trim().toLowerCase()
  const { data: userId, error: rpcErr } = await admin.rpc('relay_auth_user_id_for_email', {
    p_email: emailKey,
  })

  if (rpcErr || !userId) {
    return { action: 'reject', error: 'Email already registered', blockReason: 'email_taken' }
  }

  const uid = userId as string
  const { data: profile } = await admin
    .from('profiles')
    .select('account_status')
    .eq('id', uid)
    .maybeSingle()

  if (!profile) {
    const { error: delErr } = await admin.auth.admin.deleteUser(uid)
    if (delErr) {
      console.error('[resolveSignupEmailConflict] delete orphan auth user:', delErr.message)
      return { action: 'reject', error: 'Email already registered', blockReason: 'email_taken' }
    }
    return { action: 'reclaimed' }
  }

  const status = profile.account_status as string
  if (status === 'rejected') {
    const { error: delErr } = await admin.auth.admin.deleteUser(uid)
    if (delErr) {
      console.error('[resolveSignupEmailConflict] delete rejected user:', delErr.message)
      return { action: 'reject', error: 'Email already registered', blockReason: 'email_taken' }
    }
    return { action: 'reclaimed' }
  }

  if (status === 'pending') {
    return {
      action: 'reject',
      error:
        'You already signed up and your account is waiting for approval. Check your email or contact support.',
      blockReason: 'email_pending',
    }
  }
  if (status === 'approved') {
    return {
      action: 'reject',
      error: 'Email already registered. Try logging in instead.',
      blockReason: 'email_taken',
    }
  }
  if (status === 'blocked') {
    return {
      action: 'reject',
      error: 'This email is associated with a blocked account. Contact support if you need help.',
      blockReason: 'email_blocked',
    }
  }
  if (status === 'suspended') {
    return {
      action: 'reject',
      error: 'This email is associated with a suspended account. Contact support if you need help.',
      blockReason: 'email_suspended',
    }
  }

  return { action: 'reject', error: 'Email already registered', blockReason: 'email_taken' }
}

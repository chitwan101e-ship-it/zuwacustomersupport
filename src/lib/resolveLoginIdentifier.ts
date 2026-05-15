import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeStaffUsername } from '@/lib/staffAuthEmail'

export type ResolvedAuthLogin = {
  userId: string
  /** Email on auth.users (where OTP is sent). */
  authEmail: string
}

/**
 * Resolves the same identifiers as /login: work email, customer email, or legacy staff @handle / id.
 * Returns null when unknown or removed.
 */
export async function resolveLoginIdentifier(
  admin: SupabaseClient,
  identifier: string
): Promise<ResolvedAuthLogin | null> {
  const raw = identifier.trim()
  if (!raw) return null

  if (raw.includes('@')) {
    const emailLower = raw.toLowerCase()
    const { data: userId, error: rpcErr } = await admin.rpc('relay_auth_user_id_for_email', {
      p_email: emailLower,
    })
    if (rpcErr || !userId || typeof userId !== 'string') return null

    const { data: prof, error: pErr } = await admin
      .from('profiles')
      .select('id, deleted_at')
      .eq('id', userId)
      .maybeSingle()
    if (pErr || !prof || (prof as { deleted_at?: string | null }).deleted_at) return null

    const { data: authRes, error: authErr } = await admin.auth.admin.getUserById(userId)
    if (authErr || !authRes?.user?.email) return null
    return { userId, authEmail: authRes.user.email }
  }

  const username = normalizeStaffUsername(raw)
  if (!username) return null

  const { data: prof, error: pErr } = await admin
    .from('profiles')
    .select('id, role, business_role, deleted_at')
    .eq('username', username)
    .maybeSingle()

  if (pErr || !prof || (prof as { deleted_at?: string | null }).deleted_at) return null
  if (prof.role !== 'business' || !prof.business_role) return null

  const userId = prof.id as string
  const { data: authRes, error: authErr } = await admin.auth.admin.getUserById(userId)
  if (authErr || !authRes?.user?.email) return null
  return { userId, authEmail: authRes.user.email }
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Loader2, LogOut } from 'lucide-react'

/**
 * Customers who signed up via Create Account stay here until a business admin
 * sets profiles.account_status = 'approved' (Dashboard → Users).
 */
export default function PendingApprovalPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<'pending' | 'rejected' | 'blocked' | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        router.replace('/login')
        return
      }

      const { data: prof, error } = await supabase
        .from('profiles')
        .select('role, account_status, deleted_at')
        .eq('id', session.user.id)
        .single()

      if (error || !prof) {
        router.replace('/signup')
        return
      }

      if ((prof as { deleted_at?: string | null }).deleted_at) {
        await supabase.auth.signOut()
        router.replace('/login')
        return
      }

      const r = prof.role as 'customer' | 'business'
      const st = prof.account_status as 'pending' | 'approved' | 'rejected' | 'blocked' | 'suspended'

      if (cancelled) return

      if (r === 'business') {
        router.replace('/dashboard')
        return
      }

      if (st === 'approved') {
        router.replace('/feed')
        return
      }

      if (st === 'suspended') {
        router.replace('/account-suspended')
        return
      }

      setStatus(st ?? 'pending')
      setLoading(false)
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [router, supabase])

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  if (loading || status === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050814]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8d63ff]" />
      </div>
    )
  }

  const title =
    status === 'rejected'
      ? 'Access not granted'
      : status === 'blocked'
        ? 'Account blocked'
        : 'Waiting for approval'

  const body =
    status === 'rejected'
      ? 'Your signup was reviewed and not approved. Contact support if you think this is a mistake.'
      : status === 'blocked'
        ? 'This account is blocked. Contact support if you need help.'
        : 'A team member needs to approve your account before you can use Relay. Try signing in again after you receive confirmation.'

  return (
    <div className="min-h-screen bg-[#050814] text-white flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full rounded-3xl border border-white/10 bg-[#0b1020] p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-[#2c220f] mx-auto flex items-center justify-center text-2xl">
          {status === 'pending' ? '⏳' : '✕'}
        </div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-[#9ea8cc] text-sm leading-relaxed">{body}</p>
        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full py-3 rounded-xl border border-white/15 bg-[#11172a] hover:bg-[#151d39] flex items-center justify-center gap-2 text-sm font-semibold"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
          <Link href="/login" className="text-sm text-[#8d63ff] hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}

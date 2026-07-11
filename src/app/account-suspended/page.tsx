'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Loader2, LogOut } from 'lucide-react'

/**
 * Shown when profiles.account_status = 'suspended' (staff moderation).
 */
export default function AccountSuspendedPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)

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
        router.replace('/login')
        return
      }
      if ((prof as { deleted_at?: string | null }).deleted_at) {
        await supabase.auth.signOut()
        router.replace('/login')
        return
      }
      if (prof.role === 'business') {
        router.replace('/dashboard')
        return
      }
      if (prof.account_status === 'approved') {
        router.replace('/feed')
        return
      }
      if (prof.account_status !== 'suspended') {
        router.replace('/pending-approval')
        return
      }
      if (!cancelled) setLoading(false)
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050814]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8d63ff]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#050814] text-white flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full rounded-3xl border border-amber-500/30 bg-[#0b1020] p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/15 mx-auto flex items-center justify-center text-2xl" aria-hidden>
          ⏸
        </div>
        <h1 className="text-2xl font-bold">Account suspended</h1>
        <p className="text-[#9ea8cc] text-sm leading-relaxed">
          Your access has been paused for now because of a moderation decision. If you think this is a mistake, contact support. Staff can
          restore your access when appropriate.
        </p>
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

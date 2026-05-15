'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Loader2, LogOut } from 'lucide-react'

type AccountStatus = 'pending' | 'approved' | 'rejected' | 'blocked' | 'suspended'

type StatusCheckResult =
  | { kind: 'redirect' }
  | { kind: 'status'; status: AccountStatus }
  | { kind: 'error'; message: string }

/**
 * Customers who signed up via Create Account stay here until a business admin
 * sets profiles.account_status = 'approved' (Dashboard → Users).
 */
export default function PendingApprovalPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<'pending' | 'rejected' | 'blocked' | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkFeedback, setCheckFeedback] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  const fetchAccountStatus = useCallback(
    async (redirectOnMissing: boolean): Promise<StatusCheckResult> => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        if (redirectOnMissing) router.replace('/login')
        return { kind: 'error', message: 'You are not signed in.' }
      }

      const { data: prof, error } = await supabase
        .from('profiles')
        .select('role, account_status, deleted_at')
        .eq('id', session.user.id)
        .single()

      if (error || !prof) {
        if (redirectOnMissing) router.replace('/signup')
        return {
          kind: 'error',
          message: error?.message
            ? `Could not load account status: ${error.message}`
            : 'Could not load your profile. Try signing out and back in.',
        }
      }

      if ((prof as { deleted_at?: string | null }).deleted_at) {
        await supabase.auth.signOut()
        if (redirectOnMissing) router.replace('/login')
        return { kind: 'redirect' }
      }

      const role = prof.role as 'customer' | 'business'
      const accountStatus = prof.account_status as AccountStatus

      if (role === 'business') {
        router.replace('/dashboard')
        return { kind: 'redirect' }
      }

      if (accountStatus === 'approved') {
        router.replace('/feed?approved=1')
        return { kind: 'redirect' }
      }

      if (accountStatus === 'suspended') {
        router.replace('/account-suspended')
        return { kind: 'redirect' }
      }

      return { kind: 'status', status: accountStatus }
    },
    [router, supabase]
  )

  const applyStatusResult = useCallback((result: StatusCheckResult) => {
    if (result.kind === 'redirect') return true
    if (result.kind === 'error') return false
    if (result.status === 'rejected' || result.status === 'blocked') {
      setStatus(result.status)
      return true
    }
    setStatus('pending')
    return false
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled) return
      if (session?.user) setUserId(session.user.id)

      const result = await fetchAccountStatus(true)
      if (cancelled || result.kind === 'redirect') return
      if (result.kind === 'error') {
        setCheckFeedback(result.message)
        setStatus('pending')
        setLoading(false)
        return
      }
      applyStatusResult(result)
      setLoading(false)
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [applyStatusResult, fetchAccountStatus, supabase])

  useEffect(() => {
    if (loading || status !== 'pending' || !userId) return

    const interval = window.setInterval(() => {
      void fetchAccountStatus(false).then((result) => {
        if (result.kind === 'status' && result.status === 'pending') return
        applyStatusResult(result)
      })
    }, 8000)

    return () => window.clearInterval(interval)
  }, [loading, status, userId, fetchAccountStatus, applyStatusResult])

  useEffect(() => {
    if (loading || status !== 'pending' || !userId) return

    const channel = supabase
      .channel(`pending-profile-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { account_status?: AccountStatus }
          const st = row.account_status
          if (st === 'approved') {
            router.replace('/feed?approved=1')
          } else if (st === 'rejected' || st === 'blocked') {
            setStatus(st)
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loading, status, userId, supabase, router])

  async function checkNow() {
    setChecking(true)
    setCheckFeedback(null)
    try {
      const result = await fetchAccountStatus(false)
      if (result.kind === 'redirect') return
      if (result.kind === 'error') {
        setCheckFeedback(result.message)
        return
      }
      if (result.status === 'rejected' || result.status === 'blocked') {
        setStatus(result.status)
        return
      }
      setCheckFeedback(
        'Still waiting for team approval. This page checks every few seconds and will open your feed as soon as you are approved.'
      )
    } finally {
      setChecking(false)
    }
  }

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
        : 'A team member must approve your account. Stay on this page (or sign in again later) — when you are approved, you will be sent to your feed automatically. You will also see an alert in the app bell after your first visit.'

  return (
    <div className="min-h-screen bg-[#050814] text-white flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full rounded-3xl border border-white/10 bg-[#0b1020] p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-[#2c220f] mx-auto flex items-center justify-center text-2xl">
          {status === 'pending' ? '⏳' : '✕'}
        </div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-[#9ea8cc] text-sm leading-relaxed">{body}</p>
        {checkFeedback ? (
          <p
            className={`text-xs leading-relaxed rounded-xl px-3 py-2.5 ${
              checkFeedback.startsWith('Still waiting')
                ? 'bg-[#1a2550] text-[#aeb7d6] border border-white/10'
                : 'bg-red-500/10 text-red-200 border border-red-500/30'
            }`}
            role="status"
          >
            {checkFeedback}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 pt-2">
          {status === 'pending' ? (
            <button
              type="button"
              onClick={() => void checkNow()}
              disabled={checking}
              className="w-full py-3 rounded-xl bg-[#6f54ff] hover:bg-[#7d65ff] disabled:opacity-50 text-sm font-semibold flex items-center justify-center gap-2"
            >
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Check status now
            </button>
          ) : null}
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

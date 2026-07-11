'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { finalizeSessionAfterSignIn, redirectIfAuthenticated } from '@/lib/authRouting'
import RelayLogo from '@/components/RelayLogo'
import { Loader2, Eye, EyeOff } from 'lucide-react'

const inp =
  'w-full px-3 py-2.5 border border-white/10 bg-[#11172a] text-white placeholder:text-[#6f7896] rounded-lg text-sm focus:border-[#7c5af6] focus:ring-4 focus:ring-[#7c5af6]/20 focus:outline-none transition-all'

export default function LoginPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    const err = q.get('error')
    if (err) setError(decodeURIComponent(err))
    if (q.get('reset') === 'ok') setInfo('Password updated. Sign in with your new password.')
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await redirectIfAuthenticated(supabase, router)
    })()
    return () => {
      cancelled = true
    }
  }, [router, supabase])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const identifier = email.trim()
      if (!identifier) {
        throw new Error('Enter your email or @username.')
      }

      const useStaffId = !identifier.includes('@')

      if (useStaffId) {
        const r = await fetch('/api/auth/staff-sign-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ staffId: identifier, password }),
        })
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        if (!r.ok) throw new Error(j.error || 'Sign in failed')
        await supabase.auth.getSession()
      } else {
        const { error: signErr } = await supabase.auth.signInWithPassword({
          email: identifier,
          password,
        })
        if (signErr) throw signErr
      }

      await finalizeSessionAfterSignIn(supabase, router)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#050814] flex flex-col">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="bg-[#0b1020]/95 rounded-3xl shadow-2xl border border-white/10 w-full max-w-lg p-8">
          <div className="text-center mb-6">
            <RelayLogo size="lg" className="justify-center mb-2" />
            <p className="text-[#7f8bad] text-sm">Private messaging, beautifully simple.</p>
            <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-[#2c220f] text-[#f6b332] text-sm font-semibold">
              <span className="w-2 h-2 rounded-full bg-[#f6b332]" />
              Access requires staff approval
            </div>
            <div className="mt-5 rounded-2xl border border-white/10 bg-[#11172a] p-1 flex">
              <span className="flex-1 text-center py-2.5 text-white font-semibold rounded-xl bg-gradient-to-r from-[#7c5af6] to-[#5a7ff6]">Sign In</span>
              <Link href="/signup" className="flex-1 text-center py-2.5 text-[#7f8bad] font-semibold rounded-xl hover:text-white transition-colors">Create Account</Link>
            </div>
          </div>

          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#7f8bad] uppercase tracking-wide mb-1.5">
                Email
              </label>
              <input
                type="text"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className={inp}
                required
              />
              <p className="text-[11px] text-[#5c647e] mt-1.5">
                Sign in with your email and password. Staff can use their @username instead of email.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#7f8bad] uppercase tracking-wide mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`${inp} pr-10`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7f8bad] hover:text-white"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error ? <p className="text-red-400 text-sm">{error}</p> : null}
            {info ? <p className="text-emerald-400/90 text-sm">{info}</p> : null}

            <div className="flex justify-end">
              <Link
                href={email.trim() ? `/reset-password?i=${encodeURIComponent(email.trim())}` : '/reset-password'}
                className="text-sm text-[#8d63ff] hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#7c5af6] to-[#5a7ff6] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}

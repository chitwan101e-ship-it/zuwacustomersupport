'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import RelayLogo from '@/components/RelayLogo'
import { TURNSTILE_LOAD_ERROR } from '@/lib/userFacingErrors'
import { Loader2, Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'

const inp =
  'w-full px-3 py-2.5 border border-white/10 bg-[#11172a] text-white placeholder:text-[#6f7896] rounded-lg text-sm focus:border-[#7c5af6] focus:ring-4 focus:ring-[#7c5af6]/20 focus:outline-none transition-all'

function ResetPasswordInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const turnstileSiteKey = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim()
  const showTurnstile = Boolean(turnstileSiteKey)

  const [step, setStep] = useState<1 | 2>(1)
  const [identifier, setIdentifier] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileScriptReady, setTurnstileScriptReady] = useState(false)
  const turnstileRef = useRef<TurnstileInstance>(null)

  useEffect(() => {
    const pre = searchParams.get('i')?.trim()
    if (pre) setIdentifier(pre)
  }, [searchParams])

  useEffect(() => {
    if (!showTurnstile) return
    const timer = window.setTimeout(() => {
      const loaded = Boolean((window as Window & { turnstile?: unknown }).turnstile)
      if (!loaded && !turnstileScriptReady) {
        setError(TURNSTILE_LOAD_ERROR)
      }
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [showTurnstile, turnstileScriptReady])

  const sendCode = useCallback(async () => {
    const id = identifier.trim()
    if (!id) {
      setError('Enter your email or @username.')
      return
    }
    if (showTurnstile && !turnstileToken) {
      setError('Complete the security check.')
      return
    }
    setLoading(true)
    setError('')
    setInfo('')
    try {
      const res = await fetch('/api/auth/password-reset/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: id,
          turnstileToken: showTurnstile ? turnstileToken ?? undefined : undefined,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not send code.')
      setInfo('If an account exists for that email or username, we sent a 6-digit code. Check your inbox.')
      setStep(2)
      turnstileRef.current?.reset()
      setTurnstileToken(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not send code.')
      turnstileRef.current?.reset()
      setTurnstileToken(null)
    } finally {
      setLoading(false)
    }
  }, [identifier, showTurnstile, turnstileToken])

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/password-reset/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier.trim(),
          otp: otp.trim(),
          newPassword: password,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not reset password.')
      router.replace('/login?reset=ok')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not reset password.')
    } finally {
      setLoading(false)
    }
  }

  const back = () => {
    setStep(1)
    setError('')
    setOtp('')
    setPassword('')
    setConfirm('')
  }

  return (
    <div className="min-h-screen bg-[#050814] flex flex-col">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="bg-[#0b1020]/95 rounded-3xl shadow-2xl border border-white/10 w-full max-w-lg p-8">
          <div className="text-center mb-6">
            <RelayLogo size="lg" className="justify-center mb-2" />
            <h1 className="text-xl font-bold text-white">Reset password</h1>
            <p className="text-[#7f8bad] text-sm mt-2">
              {step === 1
                ? 'Enter the same email or @username you use to sign in. We will email you a one-time code.'
                : 'Enter the code from your email and choose a new password.'}
            </p>
          </div>

          {step === 2 ? (
            <button
              type="button"
              onClick={back}
              className="flex items-center gap-1 text-sm text-[#8d63ff] hover:underline mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              Change email or username
            </button>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#7f8bad] uppercase tracking-wide mb-1.5">
                  Email or username
                </label>
                <input
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@company.com or @username"
                  className={inp}
                />
              </div>

              {showTurnstile ? (
                <div className="flex flex-col items-center gap-2">
                  <Turnstile
                    ref={turnstileRef}
                    siteKey={turnstileSiteKey}
                    onSuccess={(t) => {
                      setTurnstileToken(t)
                      setError('')
                    }}
                    onExpire={() => setTurnstileToken(null)}
                    onWidgetLoad={() => setTurnstileScriptReady(true)}
                  />
                </div>
              ) : null}

              {error ? <p className="text-red-400 text-sm">{error}</p> : null}

              <button
                type="button"
                onClick={() => void sendCode()}
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#7c5af6] to-[#5a7ff6] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending code…
                  </>
                ) : (
                  'Send code'
                )}
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => void submitNewPassword(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#7f8bad] uppercase tracking-wide mb-1.5">
                  6-digit code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className={inp}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#7f8bad] uppercase tracking-wide mb-1.5">
                  New password
                </label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inp} pr-11`}
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#6f7896] hover:text-white"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#7f8bad] uppercase tracking-wide mb-1.5">
                  Confirm password
                </label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={inp}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </div>
              {error ? <p className="text-red-400 text-sm">{error}</p> : null}
              {info ? <p className="text-emerald-400/90 text-sm">{info}</p> : null}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#7c5af6] to-[#5a7ff6] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Updating…
                  </>
                ) : (
                  'Update password'
                )}
              </button>
            </form>
          )}

          <p className="text-center mt-8 text-sm text-[#7f8bad]">
            <Link href="/login" className="text-[#8d63ff] hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}

export default function ResetPasswordPage() {
  const fallback = useMemo(
    () => (
      <div className="min-h-screen bg-[#050814] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#7c5af6] animate-spin" />
      </div>
    ),
    []
  )

  return (
    <Suspense fallback={fallback}>
      <ResetPasswordInner />
    </Suspense>
  )
}

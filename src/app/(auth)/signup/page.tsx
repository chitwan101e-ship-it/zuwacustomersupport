'use client'
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { redirectIfAuthenticated, finalizeSessionAfterSignIn } from '@/lib/authRouting'
import RelayLogo from '@/components/RelayLogo'
import { User, Eye, EyeOff, ArrowLeft, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { combineInternationalPhone, COUNTRY_DIAL_OPTIONS } from '@/lib/countryDialCodes'
import { normalizePhoneForDedup } from '@/lib/phoneNormalize'
import { SIGNUP_OTP_VERIFICATION_FAILED } from '@/lib/signupOtp'
import { TURNSTILE_LOAD_ERROR, TURNSTILE_WIDGET_ERROR } from '@/lib/userFacingErrors'
import { isManualSignupApprovalRequired } from '@/lib/signupApproval'
import { PendingApprovalPanel } from '@/components/PendingApprovalPanel'

const manualSignupApproval = isManualSignupApprovalRequired()

type Step = 1 | 2 | 3 | 4

function passwordStrength(pw: string) {
  let score = 0
  if (pw.length >= 8) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return score
}

const strengthColors = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-green-500']
const strengthLabels = ['Weak', 'Fair', 'Good', 'Strong']

export default function SignUpPage() {
  const turnstileSiteKey = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim()
  const showTurnstile = Boolean(turnstileSiteKey)

  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [step, setStep] = useState<Step>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [phoneCountryIso, setPhoneCountryIso] = useState('US')
  const [phoneNational, setPhoneNational] = useState('')
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    question: '',
    referral: '',
    password: '',
  })
  const [showPw, setShowPw] = useState(false)
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])
  const [turnstileOtpToken, setTurnstileOtpToken] = useState<string | null>(null)
  const [turnstileScriptReady, setTurnstileScriptReady] = useState(false)
  const [turnstileUiError, setTurnstileUiError] = useState<string | null>(null)
  const turnstileOtpRef = useRef<TurnstileInstance>(null)
  const [signupNeedsSignIn, setSignupNeedsSignIn] = useState(false)

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const otpEnabled = process.env.NEXT_PUBLIC_ENABLE_OTP === 'true'

  useEffect(() => {
    if (step !== 1) return
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await redirectIfAuthenticated(supabase, router)
    })()
    return () => {
      cancelled = true
    }
  }, [router, supabase, step])

  useEffect(() => {
    if (!showTurnstile) return
    const timer = window.setTimeout(() => {
      const loaded = Boolean((window as Window & { turnstile?: unknown }).turnstile)
      if (!loaded && !turnstileScriptReady) {
        setTurnstileUiError(TURNSTILE_LOAD_ERROR)
      }
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [showTurnstile, turnstileScriptReady])

  const goBack = () => {
    if (step === 1) {
      router.push('/login')
      return
    }
    if (step === 3) {
      setStep(otpEnabled ? 2 : 1)
      setError('')
      return
    }
    if (step === 2) {
      setStep(1)
      setError('')
    }
  }

  const sendOTP = useCallback(
    async (source: 'details' | 'resend') => {
      if (source === 'details' && showTurnstile && !turnstileOtpToken) {
        setError('Complete the security check.')
        return
      }

      if (!otpEnabled) {
        setError('')
        turnstileOtpRef.current?.reset()
        setTurnstileOtpToken(null)
        setStep(3)
        return
      }

      const captchaToken = showTurnstile
        ? turnstileOtpToken
        : undefined

      if (showTurnstile && !captchaToken) {
        setError(
          source === 'resend'
            ? 'Complete the security check before resending the code.'
            : 'Complete the security check.'
        )
        return
      }

      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/auth/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.email,
            turnstileToken: captchaToken ?? undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        if (source === 'details') setStep(2)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to send code')
        turnstileOtpRef.current?.reset()
        setTurnstileOtpToken(null)
      } finally {
        setLoading(false)
      }
    },
    [otpEnabled, showTurnstile, turnstileOtpToken, form.email]
  )

  function handleOtpChange(i: number, val: string) {
    if (!/^\d?$/.test(val)) return
    const next = [...otp]
    next[i] = val
    setOtp(next)
    if (val && i < 5) otpRefs.current[i + 1]?.focus()
  }

  function handleOtpKey(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus()
  }

  async function verifyAndContinue() {
    const code = otp.join('')
    if (code.length < 6) {
      setError('Enter all 6 digits')
      return
    }
    if (!otpEnabled) {
      setStep(3)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, otp: code }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : SIGNUP_OTP_VERIFICATION_FAILED)
        return
      }
      setStep(3)
    } catch {
      setError('Could not verify the code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function register() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          otp: otp.join(''),
          firstName: form.firstName,
          lastName: form.lastName,
          username: form.username,
          phone: combineInternationalPhone(phoneCountryIso, phoneNational),
          referralUsername: form.referral,
          signupQuestion: form.question,
          turnstileToken: showTurnstile ? turnstileOtpToken ?? undefined : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === SIGNUP_OTP_VERIFICATION_FAILED) {
          setStep(2)
          setError(data.error)
          return
        }
        throw new Error(data.error)
      }

      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: form.email.trim().toLowerCase(),
        password: form.password,
      })
      if (!signErr) {
        await finalizeSessionAfterSignIn(supabase, router)
        return
      }
      setSignupNeedsSignIn(true)
      setStep(4)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const pwScore = passwordStrength(form.password)
  const fullInternationalPhone = combineInternationalPhone(phoneCountryIso, phoneNational)
  const phoneValid = normalizePhoneForDedup(fullInternationalPhone) !== null

  const progressTotal = otpEnabled ? 4 : 3
  const progressIndex =
    step === 1 ? 0 : step === 2 ? 1 : step === 3 ? (otpEnabled ? 2 : 1) : otpEnabled ? 3 : 2

  const canContinueStep1 =
    !!form.email &&
    !!form.password &&
    !!form.firstName &&
    !!form.lastName &&
    !!form.username &&
    phoneValid &&
    (!showTurnstile || !!turnstileOtpToken)

  const registerSubmitReady = true

  return (
    <div className="min-h-screen bg-[#050814] flex flex-col">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="bg-[#0b1020]/95 rounded-3xl shadow-2xl border border-white/10 w-full max-w-lg p-8">
          <div className="text-center mb-6">
            <RelayLogo size="lg" className="justify-center mb-2" />
            <p className="text-[#7f8bad] text-sm">Private messaging, beautifully simple.</p>
            <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-[#14291f] text-[#4ade80] text-sm font-semibold">
              <span className="w-2 h-2 rounded-full bg-[#4ade80]" />
              {manualSignupApproval ? 'Access requires staff approval' : 'Accounts are active right after signup'}
            </div>
            <div className="mt-5 rounded-2xl border border-white/10 bg-[#11172a] p-1 flex">
              <a
                href="/login"
                className="flex-1 text-center py-2.5 text-[#7f8bad] font-semibold rounded-xl hover:text-white transition-colors"
              >
                Sign In
              </a>
              <span className="flex-1 text-center py-2.5 text-white font-semibold rounded-xl bg-gradient-to-r from-[#7c5af6] to-[#5a7ff6]">
                Create Account
              </span>
            </div>
          </div>

          {step < 4 && (
            <div className="flex gap-1.5 justify-center mb-7">
              {Array.from({ length: progressTotal }).map((_, i) => (
                <div
                  key={i}
                  className={clsx(
                    'h-1 rounded-full transition-all duration-300',
                    i < progressIndex ? 'w-7 bg-[#8d63ff]' : i === progressIndex ? 'w-7 bg-[#5a7ff6]' : 'w-4 bg-white/20'
                  )}
                />
              ))}
            </div>
          )}

          {/* Step 1: Account details (customers only) */}
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1 text-[#8d63ff] text-sm font-medium mb-5 hover:opacity-70"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h2 className="font-display font-bold text-2xl mb-5 text-white">Create your account</h2>

              <div className="rounded-xl border border-[#8d63ff]/25 bg-[#8d63ff]/10 px-3 py-2.5 text-xs text-[#c4b5fc] mb-5 flex gap-2">
                <User className="w-4 h-4 shrink-0 mt-0.5 text-[#8d63ff]" />
                <span>
                  You will join as a <strong className="text-white">customer</strong>. Use your{' '}
                  <strong className="text-white">legal first and last name</strong> below — nicknames or fake names may
                  delay approval. Staff review every signup before you can sign in.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Legal first name">
                  <input
                    value={form.firstName}
                    onChange={(e) => set('firstName', e.target.value)}
                    placeholder="Jane"
                    className={inp}
                    autoComplete="given-name"
                  />
                </Field>
                <Field label="Legal last name">
                  <input
                    value={form.lastName}
                    onChange={(e) => set('lastName', e.target.value)}
                    placeholder="Doe"
                    className={inp}
                    autoComplete="family-name"
                  />
                </Field>
              </div>

              <Field label="Username">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f7896] text-sm">@</span>
                  <input
                    value={form.username}
                    onChange={(e) => set('username', e.target.value.replace(/^@/, ''))}
                    placeholder="janedoe"
                    className={clsx(inp, 'pl-7')}
                  />
                </div>
              </Field>

              <Field label="Email address">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  placeholder="jane@example.com"
                  className={inp}
                />
              </Field>

              <Field label="Phone number">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <select
                    value={phoneCountryIso}
                    onChange={(e) => setPhoneCountryIso(e.target.value)}
                    className={clsx(
                      inp,
                      'cursor-pointer sm:min-w-[220px] sm:max-w-[46%] shrink-0 appearance-auto'
                    )}
                    aria-label="Country calling code"
                  >
                    {COUNTRY_DIAL_OPTIONS.map((c) => (
                      <option key={c.iso} value={c.iso}>
                        {c.name} (+{c.dial})
                      </option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    value={phoneNational}
                    onChange={(e) => setPhoneNational(e.target.value)}
                    placeholder="555 123 4567"
                    className={clsx(inp, 'flex-1 min-w-0')}
                    autoComplete="tel-national"
                  />
                </div>
                <p className="text-[11px] text-[#6f7896] mt-1.5 leading-snug">
                  USA (+1) first; other countries follow by code. One customer account per phone number.
                </p>
              </Field>

              <Field label="Password">
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    placeholder="Min. 8 characters"
                    className={clsx(inp, 'pr-10')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((x) => !x)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6f7896] hover:text-white"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {form.password && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={clsx(
                            'h-1 flex-1 rounded-full transition-colors duration-300',
                            i < pwScore ? strengthColors[pwScore - 1] : 'bg-white/10'
                          )}
                        />
                      ))}
                    </div>
                    <p className={clsx('text-xs', pwScore >= 3 ? 'text-emerald-400' : 'text-[#6f7896]')}>
                      {strengthLabels[pwScore - 1] || 'Too short'}
                    </p>
                  </div>
                )}
              </Field>

              <Field label="Question (optional)">
                <textarea
                  value={form.question}
                  onChange={(e) => set('question', e.target.value)}
                  placeholder="Anything you'd like us to know before we review your account?"
                  rows={3}
                  maxLength={500}
                  className={clsx(inp, 'resize-y min-h-[4.5rem]')}
                />
                <p className="text-[11px] text-[#6f7896] mt-1.5">
                  Optional — ask a question or share context for the team reviewing your signup.
                </p>
              </Field>

              <Field label="Referral (optional)">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f7896] text-sm">@</span>
                  <input
                    value={form.referral}
                    onChange={(e) => set('referral', e.target.value.replace(/^@/, ''))}
                    placeholder="Your referral's username"
                    className={clsx(inp, 'pl-7')}
                  />
                </div>
                <p className="text-[11px] text-[#6f7896] mt-1.5">If someone invited you, add their Relay @username.</p>
              </Field>

              {error && <p className="text-red-400 text-sm mt-2">{error}</p>}

              {showTurnstile ? (
                <div className="mt-4 mb-2 flex justify-center">
                  <Turnstile
                    ref={turnstileOtpRef}
                    siteKey={turnstileSiteKey}
                    onLoadScript={() => {
                      setTurnstileScriptReady(true)
                      setTurnstileUiError(null)
                    }}
                    onError={() => setTurnstileUiError(TURNSTILE_WIDGET_ERROR)}
                    onSuccess={(token) => {
                      setTurnstileOtpToken(token)
                      setTurnstileUiError(null)
                    }}
                    onExpire={() => setTurnstileOtpToken(null)}
                    options={{ theme: 'dark', action: 'signup-otp' }}
                  />
                </div>
              ) : null}
              {showTurnstile && !turnstileUiError && !turnstileOtpToken ? (
                <p className="text-[#6f7896] text-[11px] mt-2 mb-1 text-center">
                  Complete the security check above to continue.
                </p>
              ) : null}
              {showTurnstile && turnstileUiError ? (
                <p className="text-amber-300 text-xs mt-1 mb-2">{turnstileUiError}</p>
              ) : null}

              <button
                type="button"
                onClick={() => void sendOTP('details')}
                disabled={loading || !canContinueStep1}
                className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-[#7c5af6] to-[#5a7ff6] text-white font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Sending code...
                  </>
                ) : otpEnabled ? (
                  'Send verification code'
                ) : (
                  'Continue'
                )}
              </button>
            </>
          )}

          {/* Step 2: OTP */}
          {step === 2 && otpEnabled && (
            <>
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1 text-[#8d63ff] text-sm font-medium mb-5 hover:opacity-70"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h2 className="font-display font-bold text-2xl mb-1 text-white">Verify your email</h2>
              <p className="text-[#7f8bad] text-sm mb-6">
                We sent a 6-digit code to <strong className="text-white">{form.email}</strong>. It expires in 10
                minutes.
              </p>

              <div className="flex gap-2 justify-center mb-4">
                {otp.map((v, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpRefs.current[i] = el
                    }}
                    value={v}
                    maxLength={1}
                    inputMode="numeric"
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKey(i, e)}
                    className="w-11 h-12 text-center text-lg font-semibold rounded-lg border border-white/15 bg-[#11172a] text-white focus:border-[#7c5af6] focus:ring-2 focus:ring-[#7c5af6]/30 focus:outline-none"
                  />
                ))}
              </div>

              <p className="text-center text-sm text-[#7f8bad] mb-6">
                Didn&apos;t get it?{' '}
                <button
                  type="button"
                  disabled={loading || (showTurnstile && !turnstileOtpToken)}
                  onClick={() => void sendOTP('resend')}
                  className="text-[#8d63ff] font-medium hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                >
                  Resend code
                </button>{' '}
                ·{' '}
                <button
                  type="button"
                  onClick={() => {
                    setStep(1)
                    setError('')
                  }}
                  className="text-[#8d63ff] font-medium hover:underline"
                >
                  Change email
                </button>
              </p>

              {error && <p className="text-red-400 text-sm mb-3 text-center">{error}</p>}

              <button
                type="button"
                onClick={() => void verifyAndContinue()}
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#7c5af6] to-[#5a7ff6] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
                  </>
                ) : (
                  'Verify & continue'
                )}
              </button>
            </>
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <>
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1 text-[#8d63ff] text-sm font-medium mb-5 hover:opacity-70"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h2 className="font-display font-bold text-2xl mb-1 text-white">Almost there!</h2>
              <p className="text-[#7f8bad] text-sm mb-5">Review your account before we create it.</p>
              <div className="rounded-xl border border-white/10 bg-[#11172a] p-4 space-y-2.5 mb-5 text-sm">
                <ReviewRow label="Name" value={`${form.firstName} ${form.lastName}`.trim()} />
                <ReviewRow label="Username" value={`@${form.username}`} />
                <ReviewRow label="Email" value={form.email} />
                <ReviewRow label="Phone" value={fullInternationalPhone || '—'} />
                <ReviewRow label="Question" value={form.question.trim() || '—'} />
                <ReviewRow label="Referral" value={form.referral ? `@${form.referral}` : '—'} />
                <ReviewRow label="Account type" value="Customer" />
                <ReviewRow label="Email verified" value={otpEnabled ? 'Yes (code entered)' : 'Later (not required yet)'} />
              </div>
              <p className="text-xs text-[#6f7896] mb-4 leading-relaxed">
                By creating an account you agree to Relay&apos;s Terms of Service and Privacy Policy.
              </p>
              {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
              <button
                type="button"
                onClick={() => void register()}
                disabled={loading || !registerSubmitReady}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#7c5af6] to-[#5a7ff6] text-white font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Creating account...
                  </>
                ) : (
                  'Create my account'
                )}
              </button>
            </>
          )}

          {/* Step 4: only when auto sign-in after register failed */}
          {step === 4 && manualSignupApproval && (
            <PendingApprovalPanel embedded needsSignIn={signupNeedsSignIn} />
          )}
          {step === 4 && !manualSignupApproval && (
            <div className="text-center py-2 space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
                <span className="text-2xl">✓</span>
              </div>
              <div>
                <h2 className="font-display font-bold text-2xl mb-2 text-white">Account created</h2>
                <p className="text-[#7f8bad] text-sm leading-relaxed">
                  Your account is ready. Sign in with the same email and password to open your feed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#7c5af6] to-[#5a7ff6] text-white font-semibold hover:opacity-90 transition-opacity"
              >
                Go to sign in
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

const inp =
  'w-full px-3 py-2.5 border border-white/10 bg-[#11172a] text-white placeholder:text-[#6f7896] rounded-lg text-sm focus:border-[#7c5af6] focus:ring-4 focus:ring-[#7c5af6]/20 focus:outline-none transition-all'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-[#7f8bad] uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function ReviewRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-left">
      <span className="text-[#8b96b8] shrink-0">{label}</span>
      <span
        className={clsx(
          'font-medium text-right min-w-0 break-words',
          highlight ? 'text-[#c4b5fc]' : 'text-[#e8ecff]'
        )}
      >
        {value}
      </span>
    </div>
  )
}


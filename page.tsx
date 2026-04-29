'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  User, Building2, Crown, Headphones,
  Eye, EyeOff, ArrowLeft, CheckCircle2, Loader2
} from 'lucide-react'
import clsx from 'clsx'

type Role = 'customer' | 'business'
type BusinessRole = 'admin' | 'support'
type Step = 0 | 1 | 2 | 3 | 4 | 5

function slugify(name: string) {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30)
}

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
  const router = useRouter()
  const [step, setStep] = useState<Step>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [role, setRole] = useState<Role | null>(null)
  const [bizRole, setBizRole] = useState<BusinessRole | null>(null)
  const [form, setForm] = useState({
    firstName: '', lastName: '', username: '',
    email: '', phone: '', password: '',
    businessName: '', businessSlug: '',
  })
  const [showPw, setShowPw] = useState(false)
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  const set = (k: keyof typeof form, v: string) =>
    setForm(f => ({ ...f, [k]: v }))

  // ── Step navigation ────────────────────────────────────────────────────────
  const goNext = () => setStep(s => (s + 1) as Step)
  const goBack = () => { setStep(s => (s - 1) as Step); setError('') }

  // ── Send OTP ───────────────────────────────────────────────────────────────
  async function sendOTP() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      goNext()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send code')
    } finally {
      setLoading(false)
    }
  }

  // ── OTP input handling ─────────────────────────────────────────────────────
  function handleOtpChange(i: number, val: string) {
    if (!/^\d?$/.test(val)) return
    const next = [...otp]; next[i] = val; setOtp(next)
    if (val && i < 5) otpRefs.current[i + 1]?.focus()
  }
  function handleOtpKey(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus()
  }

  // ── Verify OTP (advance to role screen or business-role screen) ────────────
  async function verifyAndContinue() {
    const code = otp.join('')
    if (code.length < 6) { setError('Enter all 6 digits'); return }
    // We verify OTP on the final submit — here just advance
    if (role === 'business') setStep(3)
    else setStep(4)
  }

  // ── Final registration ─────────────────────────────────────────────────────
  async function register() {
    setLoading(true); setError('')
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
          phone: form.phone,
          role,
          businessName: form.businessName,
          businessSlug: form.businessSlug || slugify(form.businessName),
          businessRole: bizRole,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      // Auto sign-in after registration
      const supabase = createClient()
      await supabase.auth.signInWithPassword({ email: form.email, password: form.password })

      setStep(5)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const pwScore = passwordStrength(form.password)
  const autoSlug = form.businessName ? slugify(form.businessName) : ''
  const displaySlug = form.businessSlug || autoSlug

  const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'jbcoms.com'

  // ── Step dots ──────────────────────────────────────────────────────────────
  const totalSteps = role === 'business' ? 5 : 4
  const stepDots = Array.from({ length: totalSteps })

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Topbar */}
      <header className="bg-brand-500 px-6 py-3 flex items-center gap-3 shadow">
        <span className="font-display font-bold text-2xl text-white tracking-tight">JBComs</span>
        <span className="ml-auto text-white/70 text-sm hidden sm:block">Where customers meet business</span>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 w-full max-w-md p-8">

          {/* Progress dots */}
          {step < 5 && (
            <div className="flex gap-1.5 justify-center mb-7">
              {stepDots.map((_, i) => (
                <div key={i} className={clsx(
                  'h-1 rounded-full transition-all duration-300',
                  i < step ? 'w-7 bg-green-400' :
                  i === step ? 'w-7 bg-brand-500' : 'w-4 bg-gray-200'
                )} />
              ))}
            </div>
          )}

          {/* ── STEP 0: Role selection ─────────────────────────────────────── */}
          {step === 0 && (
            <>
              <h2 className="font-display font-bold text-2xl mb-1">Create your account</h2>
              <p className="text-gray-500 text-sm mb-6">How will you be using JBComs?</p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {[
                  { r: 'customer' as Role, icon: User, label: 'Customer', desc: 'Browse announcements and contact businesses' },
                  { r: 'business' as Role, icon: Building2, label: 'Business', desc: 'Post announcements, manage customer support' },
                ].map(({ r, icon: Icon, label, desc }) => (
                  <button key={r} onClick={() => setRole(r)} className={clsx(
                    'border-2 rounded-xl p-4 text-left transition-all',
                    role === r ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-300'
                  )}>
                    <Icon className={clsx('w-6 h-6 mb-2', role === r ? 'text-brand-500' : 'text-gray-400')} />
                    <div className="font-semibold text-sm">{label}</div>
                    <div className="text-gray-500 text-xs mt-1 leading-snug">{desc}</div>
                  </button>
                ))}
              </div>
              <button disabled={!role} onClick={goNext}
                className="w-full py-3 rounded-xl bg-brand-500 text-white font-semibold disabled:opacity-40 hover:bg-brand-600 transition-colors">
                Continue
              </button>
              <p className="text-center text-sm text-gray-500 mt-4">
                Already have an account?{' '}
                <a href="/login" className="text-brand-500 font-medium hover:underline">Sign in</a>
              </p>
            </>
          )}

          {/* ── STEP 1: Account details ────────────────────────────────────── */}
          {step === 1 && (
            <>
              <button onClick={goBack} className="flex items-center gap-1 text-brand-500 text-sm font-medium mb-5 hover:opacity-70">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h2 className="font-display font-bold text-2xl mb-1">Your details</h2>
              <p className="text-gray-500 text-sm mb-5">
                {role === 'business' ? 'Set up your business account.' : 'Fill in your personal information.'}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Field label="First name">
                  <input value={form.firstName} onChange={e => set('firstName', e.target.value)}
                    placeholder="Jane" className={inp} />
                </Field>
                <Field label="Last name">
                  <input value={form.lastName} onChange={e => set('lastName', e.target.value)}
                    placeholder="Doe" className={inp} />
                </Field>
              </div>

              <Field label="Username">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                  <input value={form.username}
                    onChange={e => set('username', e.target.value.replace(/^@/, ''))}
                    placeholder="janedoe" className={clsx(inp, 'pl-7')} />
                </div>
              </Field>

              <Field label="Email address">
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  placeholder="jane@example.com" className={inp} />
              </Field>

              <Field label="Phone number">
                <div className="flex gap-2">
                  <span className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500">+1</span>
                  <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
                    placeholder="(555) 000-0000" className={clsx(inp, 'flex-1')} />
                </div>
              </Field>

              {role === 'business' && (
                <>
                  <Field label="Business name">
                    <input value={form.businessName} onChange={e => set('businessName', e.target.value)}
                      placeholder="Acme Corp" className={inp} />
                  </Field>
                  <Field label="Subdomain (auto-generated, editable)">
                    <div className="flex gap-2 items-center">
                      <input value={form.businessSlug || autoSlug}
                        onChange={e => set('businessSlug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                        placeholder={autoSlug || 'your-biz'}
                        className={clsx(inp, 'flex-1')} />
                      <span className="text-xs text-gray-400 whitespace-nowrap">.{ROOT}</span>
                    </div>
                    {displaySlug && (
                      <p className="text-xs text-brand-500 mt-1">{displaySlug}.{ROOT}</p>
                    )}
                  </Field>
                </>
              )}

              <Field label="Password">
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} value={form.password}
                    onChange={e => set('password', e.target.value)}
                    placeholder="Min. 8 characters" className={clsx(inp, 'pr-10')} />
                  <button onClick={() => setShowPw(x => !x)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {form.password && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[0,1,2,3].map(i => (
                        <div key={i} className={clsx(
                          'h-1 flex-1 rounded-full transition-colors duration-300',
                          i < pwScore ? strengthColors[pwScore - 1] : 'bg-gray-100'
                        )} />
                      ))}
                    </div>
                    <p className={clsx('text-xs', pwScore >= 3 ? 'text-green-600' : 'text-gray-400')}>
                      {strengthLabels[pwScore - 1] || 'Too short'}
                    </p>
                  </div>
                )}
              </Field>

              {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

              <button onClick={sendOTP} disabled={loading || !form.email || !form.password || !form.firstName}
                className="w-full mt-4 py-3 rounded-xl bg-brand-500 text-white font-semibold disabled:opacity-40 hover:bg-brand-600 transition-colors flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending code...</> : 'Send verification code'}
              </button>
            </>
          )}

          {/* ── STEP 2: OTP ───────────────────────────────────────────────── */}
          {step === 2 && (
            <>
              <button onClick={goBack} className="flex items-center gap-1 text-brand-500 text-sm font-medium mb-5 hover:opacity-70">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h2 className="font-display font-bold text-2xl mb-1">Verify your email</h2>
              <p className="text-gray-500 text-sm mb-6">
                We sent a 6-digit code to <strong className="text-gray-700">{form.email}</strong> via Resend.
                It expires in 10 minutes.
              </p>

              <div className="flex gap-2 justify-center mb-4">
                {otp.map((v, i) => (
                  <input key={i} ref={el => { otpRefs.current[i] = el }}
                    value={v} maxLength={1} inputMode="numeric"
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKey(i, e)}
                    className="otp-input" />
                ))}
              </div>

              <p className="text-center text-sm text-gray-500 mb-6">
                Didn't get it?{' '}
                <button onClick={sendOTP} className="text-brand-500 font-medium hover:underline">
                  Resend code
                </button>{' '}
                ·{' '}
                <button onClick={() => { setStep(1); setError('') }} className="text-brand-500 font-medium hover:underline">
                  Change email
                </button>
              </p>

              {error && <p className="text-red-500 text-sm mb-3 text-center">{error}</p>}

              <button onClick={verifyAndContinue}
                className="w-full py-3 rounded-xl bg-brand-500 text-white font-semibold hover:bg-brand-600 transition-colors">
                Verify & continue
              </button>
            </>
          )}

          {/* ── STEP 3: Business sub-role (business only) ─────────────────── */}
          {step === 3 && (
            <>
              <button onClick={goBack} className="flex items-center gap-1 text-brand-500 text-sm font-medium mb-5 hover:opacity-70">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h2 className="font-display font-bold text-2xl mb-1">Your role</h2>
              <p className="text-gray-500 text-sm mb-2">What's your role within the business?</p>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm text-blue-700 mb-5">
                Each business has <strong>1 admin</strong> and up to <strong>4 support agents</strong>.
                Only the admin can post announcements.
              </div>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {[
                  { r: 'admin' as BusinessRole, icon: Crown, label: 'Admin', badge: 'Post announcements', badgeColor: 'bg-orange-100 text-orange-700', desc: 'Full control — post announcements, manage your team' },
                  { r: 'support' as BusinessRole, icon: Headphones, label: 'Support agent', badge: 'Handle chats', badgeColor: 'bg-green-100 text-green-700', desc: 'Respond to customer messages and inquiries' },
                ].map(({ r, icon: Icon, label, badge, badgeColor, desc }) => (
                  <button key={r} onClick={() => setBizRole(r)} className={clsx(
                    'border-2 rounded-xl p-4 text-left transition-all',
                    bizRole === r ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-300'
                  )}>
                    <Icon className={clsx('w-5 h-5 mb-2', bizRole === r ? 'text-brand-500' : 'text-gray-400')} />
                    <div className="font-semibold text-sm mb-1">{label}</div>
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', badgeColor)}>{badge}</span>
                    <div className="text-gray-500 text-xs mt-2 leading-snug">{desc}</div>
                  </button>
                ))}
              </div>
              <button disabled={!bizRole} onClick={() => setStep(4)}
                className="w-full py-3 rounded-xl bg-brand-500 text-white font-semibold disabled:opacity-40 hover:bg-brand-600 transition-colors">
                Continue
              </button>
            </>
          )}

          {/* ── STEP 4: Review & submit ────────────────────────────────────── */}
          {step === 4 && (
            <>
              <button onClick={goBack} className="flex items-center gap-1 text-brand-500 text-sm font-medium mb-5 hover:opacity-70">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h2 className="font-display font-bold text-2xl mb-1">Almost there!</h2>
              <p className="text-gray-500 text-sm mb-5">Review your account before we create it.</p>
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 mb-5 text-sm">
                <ReviewRow label="Name" value={`${form.firstName} ${form.lastName}`} />
                <ReviewRow label="Username" value={`@${form.username}`} />
                <ReviewRow label="Email" value={form.email} />
                <ReviewRow label="Account type" value={role === 'business' ? 'Business' : 'Customer'} />
                {role === 'business' && <>
                  <ReviewRow label="Business" value={form.businessName} />
                  <ReviewRow label="Subdomain" value={`${displaySlug}.${ROOT}`} highlight />
                  <ReviewRow label="Role" value={bizRole === 'admin' ? 'Admin' : 'Support agent'} />
                </>}
                <ReviewRow label="Email verified" value="✅ Yes" />
              </div>
              <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                By creating an account you agree to JBComs' Terms of Service and Privacy Policy.
              </p>
              {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
              <button onClick={register} disabled={loading}
                className="w-full py-3 rounded-xl bg-brand-500 text-white font-semibold disabled:opacity-40 hover:bg-brand-600 transition-colors flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating account...</> : 'Create my account'}
              </button>
            </>
          )}

          {/* ── STEP 5: Success ────────────────────────────────────────────── */}
          {step === 5 && (
            <div className="text-center py-4">
              <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              </div>
              <h2 className="font-display font-bold text-2xl mb-2">
                {role === 'business' && bizRole === 'admin' ? 'Welcome, Admin!' :
                 role === 'business' ? 'Welcome, Agent!' : 'Welcome aboard!'}
              </h2>
              <p className="text-gray-500 text-sm mb-6">
                {role === 'business' && bizRole === 'admin'
                  ? `Your business is live at ${displaySlug}.${ROOT}`
                  : role === 'business'
                  ? "You're all set to handle customer inquiries."
                  : 'Your account is ready. Start exploring JBComs.'}
              </p>
              <div className="bg-gray-50 rounded-xl p-4 text-left space-y-2 text-sm mb-6">
                {role === 'business' && bizRole === 'admin' ? <>
                  <NextStep>Post your first announcement</NextStep>
                  <NextStep>Invite your support team</NextStep>
                  <NextStep>Customize your business profile</NextStep>
                </> : role === 'business' ? <>
                  <NextStep>View your conversation queue</NextStep>
                  <NextStep>Update your availability status</NextStep>
                  <NextStep>Review business announcements</NextStep>
                </> : <>
                  <NextStep>Follow businesses you care about</NextStep>
                  <NextStep>Browse the latest announcements</NextStep>
                  <NextStep>Start a conversation with a business</NextStep>
                </>}
              </div>
              <button onClick={() => router.push(
                role === 'business'
                  ? `/dashboard`
                  : `/feed`
              )} className="w-full py-3 rounded-xl bg-brand-500 text-white font-semibold hover:bg-brand-600 transition-colors">
                Go to my dashboard →
              </button>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}

// Sub-components
const inp = "w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none transition-all"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function ReviewRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={clsx('font-medium', highlight ? 'text-brand-500' : 'text-gray-800')}>{value}</span>
    </div>
  )
}

function NextStep({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-gray-600">
      <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
      {children}
    </div>
  )
}

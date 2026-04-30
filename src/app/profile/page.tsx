'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Moon, Sun, Sparkles } from 'lucide-react'

type ProfileRow = {
  id: string
  role: 'customer' | 'business'
  username: string
  first_name: string
  last_name: string
  created_at: string
  account_status?: string
}

type AppearanceMode = 'dark' | 'light' | 'playful'
const APPEARANCE_KEY = 'relay-appearance'

function getStoredAppearance(): AppearanceMode {
  if (typeof window === 'undefined') return 'dark'
  const stored = window.localStorage.getItem(APPEARANCE_KEY)
  if (stored === 'dark' || stored === 'light' || stored === 'playful') return stored
  return 'dark'
}

function applyAppearanceClass(mode: AppearanceMode) {
  const root = document.documentElement
  root.classList.remove('relay-theme-dark', 'relay-theme-light', 'relay-theme-playful')
  root.classList.add(`relay-theme-${mode}`)
}

export default function ProfilePage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [email, setEmail] = useState('')
  const [appearance, setAppearance] = useState<AppearanceMode>(() => getStoredAppearance())

  useEffect(() => {
    let cancelled = false

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        router.replace('/signup')
        return
      }

      setEmail(session.user.email || '')

      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, username, first_name, last_name, created_at, account_status, deleted_at')
        .eq('id', session.user.id)
        .single()

      if (error || !data) {
        router.replace('/signup')
        return
      }

      const row = data as ProfileRow & { deleted_at?: string | null }
      if (row.deleted_at) {
        await supabase.auth.signOut()
        router.replace('/login')
        return
      }

      if (row.role === 'customer' && row.account_status === 'suspended') {
        router.replace('/account-suspended')
        return
      }

      if (row.role === 'customer' && row.account_status !== 'approved') {
        router.replace('/pending-approval')
        return
      }

      if (cancelled) return
      setProfile(row)
      setLoading(false)
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [router, supabase])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(APPEARANCE_KEY, appearance)
    applyAppearanceClass(appearance)
  }, [appearance])

  async function signOut() {
    if (!window.confirm('Are you sure you want to sign out?')) return
    await supabase.auth.signOut()
    router.replace('/signup')
  }

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050814]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8d63ff]" />
      </div>
    )
  }

  const displayName = `${profile.first_name} ${profile.last_name}`.trim() || profile.username
  const initials =
    (profile.first_name?.[0] || profile.username?.[0] || '?').toUpperCase() +
    (profile.last_name?.[0] || '').toUpperCase()
  const isLight = appearance === 'light'
  const isPlayful = appearance === 'playful'
  const pageBg = isLight
    ? 'bg-[radial-gradient(circle_at_top,_#eef2ff_0%,_#f8faff_42%,_#ffffff_100%)] text-slate-900'
    : isPlayful
      ? 'bg-[radial-gradient(circle_at_top,_#2b1d63_0%,_#100e2a_40%,_#070713_100%)] text-white'
      : 'bg-[#050814] text-white'
  const cardBg = isLight ? 'bg-white border-slate-200' : 'bg-[#0b1020]/95 border-white/10'
  const mutedText = isLight ? 'text-slate-500' : 'text-[#7f8bad]'
  const titleText = isLight ? 'text-slate-900 font-bold' : 'text-white font-bold'
  const bodyText = isLight ? 'text-slate-700' : 'text-white'

  const appearanceOptions = [
    { id: 'dark' as const, label: 'Dark', icon: Moon, hint: 'High contrast' },
    { id: 'light' as const, label: 'Light', icon: Sun, hint: 'Clean and bright' },
    { id: 'playful' as const, label: 'Playful', icon: Sparkles, hint: 'More vibrant accents' },
  ]

  return (
    <div className={`min-h-screen ${pageBg}`}>
      <header className="px-4 pt-4 pb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.push('/feed')}
          className="p-2 rounded-full hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className={`w-5 h-5 ${isLight ? 'text-slate-600' : 'text-[#b8c0dc]'}`} />
        </button>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
      </header>

      <main className="max-w-md mx-auto px-4 pb-10">
        <div className="mt-4 flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-[#d12f2f] text-white text-3xl font-bold flex items-center justify-center">
            {initials}
          </div>
          <div>
            <h2 className={`text-4xl leading-none mb-1 ${titleText}`}>{displayName}</h2>
            <p className={`${mutedText} text-sm`}>{email || `${profile.username}@relay.app`}</p>
            <div className="inline-flex items-center gap-2 mt-2 px-3 py-1 rounded-full bg-[#0b2a22] text-[#2fd17f] text-sm font-semibold">
              <span className="w-2 h-2 rounded-full bg-[#2fd17f]" />
              Approved
            </div>
          </div>
        </div>

        <section className={`mt-7 border rounded-3xl p-5 ${cardBg}`}>
          <p className={`${mutedText} text-xs font-semibold uppercase tracking-wider mb-4`}>Appearance</p>
          <div className="grid grid-cols-3 gap-2.5">
            {appearanceOptions.map(({ id, label, icon: Icon, hint }) => (
              <button
                key={id}
                type="button"
                onClick={() => setAppearance(id)}
                className={`rounded-2xl border px-2 py-3 text-center transition-all ${
                  appearance === id
                    ? 'border-[#8d63ff] bg-[#1a2040] text-[#8d63ff]'
                    : isLight
                      ? 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                      : 'border-white/10 bg-[#11172a] text-[#7f8bad] hover:border-white/20'
                }`}
              >
                <Icon className="w-4 h-4 mx-auto mb-1" />
                <span className="text-xs font-semibold">{label}</span>
                <span className="mt-0.5 block text-[10px] opacity-75">{hint}</span>
              </button>
            ))}
          </div>
          <p className={`mt-3 text-[11px] ${isLight ? 'text-slate-500' : 'text-[#8f9bc4]'}`}>Saved to your device and used across supported screens.</p>
        </section>

        <section className={`mt-5 border rounded-3xl p-5 ${cardBg}`}>
          <p className={`${mutedText} text-xs font-semibold uppercase tracking-wider mb-4`}>Account</p>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <span className={mutedText}>Member since</span>
              <span className={`font-semibold ${bodyText}`}>
                {new Date(profile.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <span className={mutedText}>Status</span>
              <span className={`font-semibold ${bodyText}`}>Approved</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={mutedText}>Role</span>
              <span className={`font-semibold capitalize ${bodyText}`}>{profile.role}</span>
            </div>
          </div>
        </section>

        <button
          type="button"
          onClick={() => void signOut()}
          className={`w-full mt-8 py-3 rounded-xl transition-colors font-semibold ${isLight ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100' : 'text-[#7f8bad] hover:text-white hover:bg-white/5'}`}
        >
          Sign Out
        </button>
      </main>
    </div>
  )
}

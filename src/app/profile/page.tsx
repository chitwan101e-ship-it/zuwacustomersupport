'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Camera, Loader2, Moon, Sparkles } from 'lucide-react'
import { CustomerMobileFooterNav } from '@/components/CustomerMobileFooterNav'

type ProfileRow = {
  id: string
  role: 'customer' | 'business'
  username: string
  first_name: string
  last_name: string
  avatar_url?: string | null
  created_at: string
  account_status?: string
}

type AppearanceMode = 'dark' | 'playful'
const APPEARANCE_KEY = 'relay-appearance'

function getStoredAppearance(): AppearanceMode {
  if (typeof window === 'undefined') return 'dark'
  const stored = window.localStorage.getItem(APPEARANCE_KEY)
  if (stored === 'playful') return 'playful'
  if (stored === 'dark' || stored === 'light') return 'dark'
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
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [appearance, setAppearance] = useState<AppearanceMode>(() => getStoredAppearance())
  const avatarInputRef = useRef<HTMLInputElement>(null)

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

      setEmail(session.user.email || '')

      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, username, first_name, last_name, avatar_url, created_at, account_status, deleted_at')
        .eq('id', session.user.id)
        .single()

      if (error || !data) {
        router.replace('/login')
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
    router.replace('/login')
  }

  function extFromImageFile(f: File) {
    if (f.type === 'image/png') return 'png'
    if (f.type === 'image/webp') return 'webp'
    if (f.type === 'image/gif') return 'gif'
    return 'jpg'
  }

  async function uploadAvatar(file: File) {
    if (!profile) return
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Please choose an image under 5 MB.')
      return
    }

    setAvatarBusy(true)
    try {
      const ext = extFromImageFile(file)
      const path = `${profile.id}/avatar.${ext}`
      const { error: upErr } = await supabase.storage.from('profile-images').upload(path, file, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      })
      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from('profile-images').getPublicUrl(path)
      const nextUrl = `${pub.publicUrl}?v=${Date.now()}`
      const { error: saveErr } = await supabase.from('profiles').update({ avatar_url: nextUrl }).eq('id', profile.id)
      if (saveErr) throw saveErr
      setProfile((prev) => (prev ? { ...prev, avatar_url: nextUrl } : prev))
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Could not upload profile photo.')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function onAvatarPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    await uploadAvatar(f)
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
  const isPlayful = appearance === 'playful'
  const pageBg = isPlayful
    ? 'bg-[radial-gradient(circle_at_top,_#2b1d63_0%,_#100e2a_40%,_#070713_100%)] text-white'
    : 'bg-[radial-gradient(circle_at_top,_#1c2757_0%,_#070a18_42%,_#050814_100%)] text-white'
  const cardBg = 'bg-[#0b1020]/95 border-white/10'
  const mutedText = 'text-[#7f8bad]'
  const titleText = 'text-white font-semibold'
  const bodyText = 'text-[#c4cbe6]'

  const appearanceOptions = [
    { id: 'dark' as const, label: 'Dark', icon: Moon, hint: 'Default Relay' },
    { id: 'playful' as const, label: 'Playful', icon: Sparkles, hint: 'Richer purple' },
  ]

  return (
    <div className={`min-h-screen text-[14px] leading-snug ${pageBg}`}>
      <header className="px-4 pt-3 pb-2 flex items-center gap-2 border-b border-white/[0.08] bg-[#0b1020]/40 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => router.push('/feed')}
          className="p-2 rounded-full hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-[#b8c0dc]" />
        </button>
        <h1 className="text-lg font-bold tracking-tight text-white">Profile</h1>
      </header>

      <main
        className={`max-w-md mx-auto px-4 pt-4 ${profile.role === 'customer' ? 'pb-28' : 'pb-24'}`}
      >
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onAvatarPick(e)} />
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={`${displayName} profile`}
                className="w-16 h-16 rounded-full object-cover border border-white/10 bg-[#11172a]"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-[#d12f2f] text-white text-lg font-bold flex items-center justify-center border border-white/10">
                {initials}
              </div>
            )}
            {avatarBusy ? (
              <div
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 ring-2 ring-black/20"
                aria-live="polite"
              >
                <Loader2 className="w-6 h-6 animate-spin text-white" aria-hidden />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarBusy}
              className="absolute left-[94.19%] top-[94.19%] z-[1] flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/25 text-white shadow-sm backdrop-blur-sm hover:bg-black/40 hover:border-white/35 active:scale-95 disabled:pointer-events-none disabled:opacity-40 transition-colors"
              aria-label="Change profile photo"
              title="Change profile photo"
            >
              <Camera className="w-[15px] h-[15px]" strokeWidth={2.25} aria-hidden />
            </button>
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className={`text-lg sm:text-xl font-semibold leading-tight truncate ${titleText}`}>{displayName}</h2>
            <p className={`${mutedText} text-[13px] mt-0.5 truncate`}>{email || `${profile.username}@relay.app`}</p>
            <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-0.5 rounded-full bg-[#0b2a22] text-[#2fd17f] text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2fd17f]" />
              Approved
            </div>
          </div>
        </div>

        <section className={`mt-5 border rounded-2xl p-4 ${cardBg}`}>
          <p className={`${mutedText} text-[10px] font-bold uppercase tracking-[0.15em] mb-3`}>Appearance</p>
          <div className="grid grid-cols-2 gap-2">
            {appearanceOptions.map(({ id, label, icon: Icon, hint }) => (
              <button
                key={id}
                type="button"
                onClick={() => setAppearance(id)}
                className={`rounded-xl border px-2 py-2.5 text-center transition-all ${
                  appearance === id
                    ? 'border-[#8d63ff] bg-[#1a2040] text-[#8d63ff]'
                    : 'border-white/10 bg-[#11172a] text-[#7f8bad] hover:border-white/20'
                }`}
              >
                <Icon className="w-4 h-4 mx-auto mb-1" />
                <span className="text-[12px] font-semibold">{label}</span>
                <span className="mt-0.5 block text-[10px] opacity-75 leading-tight">{hint}</span>
              </button>
            ))}
          </div>
          <p className={`mt-2.5 text-[11px] ${mutedText}`}>Saved on this device and used on the home screen.</p>
        </section>

        <section className={`mt-4 border rounded-2xl p-4 ${cardBg}`}>
          <p className={`${mutedText} text-[10px] font-bold uppercase tracking-[0.15em] mb-3`}>Account</p>
          <div className="space-y-2.5 text-[13px]">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className={mutedText}>Member since</span>
              <span className={`font-medium ${bodyText}`}>
                {new Date(profile.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className={mutedText}>Status</span>
              <span className={`font-medium ${bodyText}`}>Approved</span>
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <span className={mutedText}>Role</span>
              <span className={`font-medium capitalize ${bodyText}`}>{profile.role}</span>
            </div>
          </div>
        </section>

        <button
          type="button"
          onClick={() => void signOut()}
          className="w-full mt-6 py-2.5 rounded-xl text-[13px] font-semibold text-[#7f8bad] hover:text-white hover:bg-white/5 transition-colors"
        >
          Sign out
        </button>
      </main>

      {profile.role === 'customer' ? (
        <CustomerMobileFooterNav
          isLight={false}
          onChatClick={() => router.push('/feed?openChat=1')}
        />
      ) : null}
    </div>
  )
}

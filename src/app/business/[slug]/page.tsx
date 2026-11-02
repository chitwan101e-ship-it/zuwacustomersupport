'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import RelayLogo from '@/components/RelayLogo'
import { FeedPostImage } from '@/components/FeedPostImage'
import { ArrowLeft, Building2, Loader2, UserPlus, UserMinus } from 'lucide-react'
import clsx from 'clsx'

type Biz = { id: string; name: string; slug: string; description: string | null; logo_url: string | null }
type Ann = {
  id: string
  title: string
  body: string
  image_url: string | null
  created_at: string
}

function timeAgo(iso: string) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function PublicBusinessPage() {
  const params = useParams()
  const slug = typeof params?.slug === 'string' ? params.slug : ''
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [biz, setBiz] = useState<Biz | null>(null)
  const [announcements, setAnnouncements] = useState<Ann[]>([])
  const [error, setError] = useState<string | null>(null)

  const [uid, setUid] = useState<string | null>(null)
  const [isCustomer, setIsCustomer] = useState(false)
  const [following, setFollowing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)

  const load = useCallback(async () => {
    if (!slug) return
    setLoading(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const userId = session?.user?.id ?? null
      setUid(userId)

      if (userId) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('id, role, account_status, deleted_at')
          .eq('id', userId)
          .maybeSingle()
        const p = prof as { role: string; account_status?: string; deleted_at?: string | null } | null
        setIsCustomer(
          Boolean(p?.role === 'customer' && !p?.deleted_at && p?.account_status === 'approved')
        )
      } else {
        setIsCustomer(false)
      }

      const { data: b, error: bErr } = await supabase.from('businesses').select('*').eq('slug', slug).maybeSingle()
      if (bErr || !b) {
        setBiz(null)
        setAnnouncements([])
        setError('Business not found.')
        return
      }
      setBiz(b as Biz)

      const { data: ann, error: aErr } = await supabase
        .from('announcements')
        .select('id, title, body, image_url, created_at')
        .eq('business_id', (b as Biz).id)
        .is('deleted_at', null)
        .is('hidden_at', null)
        .order('created_at', { ascending: false })
        .limit(30)

      if (aErr) {
        setAnnouncements([])
      } else {
        setAnnouncements((ann || []) as Ann[])
      }

      if (userId && b) {
        const { data: fol } = await supabase
          .from('follows')
          .select('user_id')
          .eq('user_id', userId)
          .eq('business_id', (b as Biz).id)
          .maybeSingle()
        setFollowing(!!fol)
      } else {
        setFollowing(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }, [slug, supabase])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleFollow() {
    if (!uid || !biz || !isCustomer) {
      router.push('/login')
      return
    }
    setFollowBusy(true)
    try {
      if (following) {
        const { error: delErr } = await supabase.from('follows').delete().eq('user_id', uid).eq('business_id', biz.id)
        if (delErr) throw delErr
        setFollowing(false)
      } else {
        const { error: insErr } = await supabase.from('follows').insert({ user_id: uid, business_id: biz.id })
        if (insErr) throw insErr
        setFollowing(true)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setFollowBusy(false)
    }
  }

  if (!slug) {
    return (
      <div className="relay-lobby min-h-screen text-[#fff8ee] flex items-center justify-center">
        <p className="text-[#cbb89a]">Invalid link.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="relay-lobby min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#e7b84a]" />
      </div>
    )
  }

  if (error || !biz) {
    return (
      <div className="relay-lobby min-h-screen text-[#fff8ee] px-4 py-10">
        <div className="max-w-lg mx-auto text-center">
          <p className="text-[#f87171] mb-4">{error || 'Not found.'}</p>
          <Link href="/feed" className="text-[#f0c86a] hover:underline">
            Back to feed
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="relay-lobby min-h-screen text-[#fff8ee]">
      <header className="sticky top-0 z-20 border-b border-[#edc06e]/25 bg-[#120e1c]/85 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 rounded-full hover:bg-white/10"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-[#f9d587]" />
          </button>
          <RelayLogo theme="dark" size="sm" accent="gold" showWordmark={false} />
          <Link href="/feed" className="ml-auto text-sm font-semibold tracking-wide text-[#f0c86a] hover:underline">
            Open app
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 pb-16">
        <div className="flex flex-col sm:flex-row sm:items-start gap-6">
          <div
            className={clsx(
              'w-20 h-20 rounded-2xl flex items-center justify-center shrink-0 border border-white/10',
              biz.logo_url ? 'p-0 overflow-hidden bg-black/20' : 'bg-gradient-to-b from-[#fff6d4] to-[#c9922e]'
            )}
          >
            {biz.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={biz.logo_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <Building2 className="w-10 h-10 text-[#3a2508]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="relay-gold-type text-3xl font-extrabold tracking-tight">{biz.name}</h1>
            <p className="text-[#e7c373] text-sm mt-1 tracking-wide">@{biz.slug}</p>
            {biz.description ? <p className="text-[#e4d8f0] mt-3 leading-relaxed">{biz.description}</p> : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {isCustomer ? (
                <button
                  type="button"
                  disabled={followBusy}
                  onClick={() => void toggleFollow()}
                  className={clsx(
                    'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors',
                    following
                      ? 'bg-white/10 text-[#fff6e8] border border-[#e1b55d]/35 hover:bg-white/15'
                      : 'bg-gradient-to-b from-[#fff6d4] to-[#c9922e] text-[#3a2508]'
                  )}
                >
                  {followBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : following ? (
                    <>
                      <UserMinus className="w-4 h-4" /> Following
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" /> Follow
                    </>
                  )}
                </button>
              ) : (
                <Link
                  href="/signup"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-gradient-to-b from-[#fff6d4] to-[#c9922e] text-[#3a2508]"
                >
                  <UserPlus className="w-4 h-4" /> Sign up to follow
                </Link>
              )}
            </div>
          </div>
        </div>

        <section className="mt-12">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e7c373] mb-4">Announcements</h2>
          {announcements.length === 0 ? (
            <p className="text-[#cbb89a] text-sm">No posts yet.</p>
          ) : (
            <ul className="space-y-4">
              {announcements.map((a) => (
                <li
                  key={a.id}
                  className="rounded-2xl border border-[#e1b55d]/32 bg-[#1a1428]/95 p-4"
                >
                  <p className="text-xs text-[#cbb89a] mb-2">{timeAgo(a.created_at)}</p>
                  <p className="font-semibold text-[#fff6e8] text-lg">{a.title}</p>
                  <p className="text-[#e4d8f0] mt-2 whitespace-pre-wrap leading-relaxed">{a.body}</p>
                  {a.image_url ? (
                    <div className="mt-3">
                      <FeedPostImage imageUrl={a.image_url} alt="" rounded="xl" />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

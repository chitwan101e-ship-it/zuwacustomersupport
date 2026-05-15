'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import RelayLogo from '@/components/RelayLogo'
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
      <div className="min-h-screen bg-[#050814] text-white flex items-center justify-center">
        <p className="text-[#7f8bad]">Invalid link.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050814]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8d63ff]" />
      </div>
    )
  }

  if (error || !biz) {
    return (
      <div className="min-h-screen bg-[#050814] text-white px-4 py-10">
        <div className="max-w-lg mx-auto text-center">
          <p className="text-[#f87171] mb-4">{error || 'Not found.'}</p>
          <Link href="/feed" className="text-[#8d63ff] hover:underline">
            Back to feed
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1c2757_0%,_#070a18_42%,_#050814_100%)] text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0b1020]/90 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 rounded-full hover:bg-white/10"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-[#b8c0dc]" />
          </button>
          <RelayLogo theme="dark" size="sm" showWordmark={false} />
          <Link href="/feed" className="ml-auto text-sm font-semibold text-[#8d63ff] hover:underline">
            Open app
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 pb-16">
        <div className="flex flex-col sm:flex-row sm:items-start gap-6">
          <div
            className={clsx(
              'w-20 h-20 rounded-2xl flex items-center justify-center shrink-0 border border-white/10',
              biz.logo_url ? 'p-0 overflow-hidden bg-black/20' : 'bg-gradient-to-br from-[#7c5af6] to-[#3d5cff]'
            )}
          >
            {biz.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={biz.logo_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <Building2 className="w-10 h-10 text-white" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-extrabold tracking-tight">{biz.name}</h1>
            <p className="text-[#8d63ff] text-sm mt-1">@{biz.slug}</p>
            {biz.description ? <p className="text-[#b8c0dc] mt-3 leading-relaxed">{biz.description}</p> : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {isCustomer ? (
                <button
                  type="button"
                  disabled={followBusy}
                  onClick={() => void toggleFollow()}
                  className={clsx(
                    'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors',
                    following
                      ? 'bg-white/10 text-white border border-white/20 hover:bg-white/15'
                      : 'bg-[#8d63ff] text-white hover:bg-[#7a4fe6]'
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
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-[#8d63ff] text-white hover:bg-[#7a4fe6]"
                >
                  <UserPlus className="w-4 h-4" /> Sign up to follow
                </Link>
              )}
            </div>
          </div>
        </div>

        <section className="mt-12">
          <h2 className="text-lg font-bold text-white mb-4">Announcements</h2>
          {announcements.length === 0 ? (
            <p className="text-[#7f8bad] text-sm">No posts yet.</p>
          ) : (
            <ul className="space-y-4">
              {announcements.map((a) => (
                <li
                  key={a.id}
                  className="rounded-2xl border border-white/10 bg-[#0e1734]/80 p-4 shadow-[0_20px_55px_-35px_rgba(37,58,134,0.9)]"
                >
                  <p className="text-xs text-[#7f8bad] mb-2">{timeAgo(a.created_at)}</p>
                  <p className="font-semibold text-white text-lg">{a.title}</p>
                  <p className="text-[#d4dbf0] mt-2 whitespace-pre-wrap leading-relaxed">{a.body}</p>
                  {a.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.image_url}
                      alt=""
                      className="mt-3 w-full max-h-80 object-cover rounded-xl border border-white/10"
                    />
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

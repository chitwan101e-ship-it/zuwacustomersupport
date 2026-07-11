'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { CustomerMobileFooterNav } from '@/components/CustomerMobileFooterNav'

const DOWNLOAD_GUIDE_URL = 'https://www.juwa777.com/blog-download-juwa-777'

const downloadGuideLinkClass =
  'font-semibold text-[#8d63ff] underline decoration-[#8d63ff]/50 underline-offset-2 hover:text-[#b8a6ff]'

function DownloadGuideLink() {
  return (
    <a href={DOWNLOAD_GUIDE_URL} target="_blank" rel="noopener noreferrer" className={downloadGuideLinkClass}>
      download guide
    </a>
  )
}

export default function RulesPage() {
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
        .select('id, role, account_status, deleted_at')
        .eq('id', session.user.id)
        .single()
      if (error || !prof) {
        router.replace('/login')
        return
      }
      const row = prof as { role: string; account_status?: string; deleted_at?: string | null }
      if (row.deleted_at) {
        await supabase.auth.signOut()
        router.replace('/login')
        return
      }
      if (row.role === 'business') {
        router.replace('/dashboard')
        return
      }
      if (row.account_status === 'suspended') {
        router.replace('/account-suspended')
        return
      }
      if (row.account_status !== 'approved') {
        router.replace('/pending-approval')
        return
      }
      if (cancelled) return
      setLoading(false)
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [router, supabase])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050814]">
        <Loader2 className="h-8 w-8 animate-spin text-[#8d63ff]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_#0f1840_0%,_#070a18_45%,_#050814_100%)] text-[14px] leading-snug text-white">
      <header className="flex items-center gap-2 border-b border-white/[0.08] bg-[#0b1020]/40 px-4 pb-2 pt-3 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => router.push('/feed')}
          className="rounded-full p-2 hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5 text-[#b8c0dc]" />
        </button>
        <h1 className="text-lg font-bold tracking-tight text-white">Program rules</h1>
      </header>

      <main className="mx-auto max-w-lg px-4 pb-28 pt-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8892b0]">Summary</p>
        <ul className="mt-3 space-y-3 text-[13px] leading-relaxed text-[#c4cbe6]">
          <li>
            <span className="font-semibold text-white">Minimum deposit:</span> $10.
          </li>
          <li>
            <span className="font-semibold text-white">Minimum withdrawal:</span> $40.
          </li>
          <li>
            <span className="font-semibold text-white">Account maximum:</span> $2,000.
          </li>
          <li>
            <span className="font-semibold text-white">Daily limit:</span> $500.
          </li>
          <li>
            <span className="font-semibold text-white">Referral bonus:</span> 100%.
          </li>
        </ul>

        <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8892b0]">Promotions</p>
        <div className="mt-3 rounded-2xl border border-[#8d63ff]/25 bg-[#8d63ff]/10 p-4">
          <h2 className="text-[15px] font-bold text-white">FREE Play promo</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[#c4cbe6]">
            Announced every <span className="font-semibold text-white">Thursday</span> on Relay — check your feed and
            messages for the latest details.
          </p>
          <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-[#aeb7d6]">Rules</p>
          <ul className="mt-2 space-y-2 text-[13px] leading-relaxed text-[#c4cbe6] list-disc pl-5">
            <li>
              Open to players who have{' '}
              <span className="font-semibold text-white">played on the platform before</span> (not first-time accounts
              only).
            </li>
            <li>Other terms may apply each week; follow the Thursday announcement for full details.</li>
          </ul>
        </div>

        <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8892b0]">Profile photo</p>
        <div className="mt-3 rounded-2xl border border-white/[0.08] bg-[rgba(11,18,40,0.9)] p-4 text-[13px] leading-relaxed text-[#c4cbe6]">
          <p>
            Within <span className="font-semibold text-white">5 days of account approval</span>, add a profile photo
            that clearly shows <span className="font-semibold text-white">you</span> — not logos, memes, pets, or other
            unrelated images.
          </p>
          <ul className="mt-3 space-y-2 list-disc pl-5 text-[#aeb7d6]">
            <li>
              <span className="font-semibold text-white">Have played on the platform?</span> You are not subject to
              suspension or removal for missing a profile photo.
            </li>
            <li>
              <span className="font-semibold text-white">Have not played yet?</span> You must upload an acceptable
              profile photo within 5 days of approval. Accounts that do not may be suspended or removed.
            </li>
          </ul>
        </div>

        <p className="mt-5 text-[12px] leading-relaxed text-[#7f8bad] border-l-2 border-[#8d63ff]/35 pl-3.5">
          Relay may suspend or restrict accounts that break these program rules, abuse the platform, or put other
          members at risk. We exercise this only when we believe it is necessary to keep Relay fair and safe for
          everyone.
        </p>
        <div className="mt-5 space-y-3 rounded-2xl border border-white/[0.08] bg-[rgba(11,18,40,0.9)] p-4 text-[13px] leading-relaxed text-[#8892b0]">
          <p>
            Problem with installation? Check out the <DownloadGuideLink />.
          </p>
          <p>
            For more information, open <span className="font-semibold text-[#8d63ff]">Chat</span> from the bar below
            and message our team.
          </p>
        </div>
      </main>

      <CustomerMobileFooterNav isLight={false} onChatClick={() => router.push('/feed?openChat=1')} />
    </div>
  )
}

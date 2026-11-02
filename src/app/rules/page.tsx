'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { CustomerMobileFooterNav } from '@/components/CustomerMobileFooterNav'

const DOWNLOAD_GUIDE_URL = 'https://www.juwa777.com/blog-download-juwa-777'

const downloadGuideLinkClass =
  'font-semibold text-[#f0c86a] underline decoration-[#e7b84a]/50 underline-offset-2 hover:text-[#fff1c2]'

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
      <div className="relay-customer-dark relay-lobby min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#e7b84a]" />
      </div>
    )
  }

  return (
    <div className="relay-customer-dark relay-lobby min-h-screen text-[14px] leading-snug text-[#fff8ee]">
      <header className="flex items-center gap-2 border-b border-[#edc06e]/25 bg-[#120e1c]/75 px-4 pb-2 pt-3 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => router.push('/feed')}
          className="rounded-full p-2 hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5 text-[#f9d587]" />
        </button>
        <h1 className="relay-gold-type text-lg font-semibold tracking-tight">Program rules</h1>
      </header>

      <main className="mx-auto max-w-lg px-4 pb-28 pt-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#e7c373]">Summary</p>
        <ul className="mt-3 space-y-3 text-[13px] leading-relaxed text-[#e4d8f0]">
          <li>
            <span className="font-semibold text-[#fff6e8]">Minimum deposit:</span> $10.
          </li>
          <li>
            <span className="font-semibold text-[#fff6e8]">Minimum withdrawal:</span> $40.
          </li>
          <li>
            <span className="font-semibold text-[#fff6e8]">Account maximum:</span> $2,000.
          </li>
          <li>
            <span className="font-semibold text-[#fff6e8]">Daily limit:</span> $500.
          </li>
          <li>
            <span className="font-semibold text-[#fff6e8]">Referral bonus:</span> 100%.
          </li>
        </ul>

        <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.16em] text-[#e7c373]">Promotions</p>
        <div className="mt-3 rounded-2xl border border-[#e1b55d]/35 bg-[#1a1428]/95 p-4">
          <h2 className="text-[15px] font-bold text-[#fff6e8]">Free spin every 48 hours</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[#e4d8f0]">
            The free spin is reserved for <span className="font-semibold text-[#fff6e8]">active players</span>. An
            active player is someone who has made a deposit and has played with us before. Please contact your agent if
            you would like to become an active player, or if you have already done so. One free spin every 48 hours.
            After you spin, your next free spin opens 48 hours later. Credits are awarded in whole credits.
          </p>
          <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-[#e7c373]">Rules</p>
          <ul className="mt-2 space-y-2 text-[13px] leading-relaxed text-[#e4d8f0] list-disc pl-5">
            <li>
              A decimal win is rounded to the nearest whole number.{' '}
              <span className="font-semibold text-[#fff6e8]">3.3 becomes 3.</span>
            </li>
            <li>
              <span className="font-semibold text-[#fff6e8]">3.5 and above</span> rounds up.{' '}
              <span className="font-semibold text-[#fff6e8]">3.5 becomes 4.</span>
            </li>
          </ul>
          <p className="mt-3 border-l-2 border-[#e7b84a]/60 pl-3 text-[12px] leading-relaxed text-[#cbb89a]">
            These rules can be voided. Please contact an admin for more information.
          </p>
        </div>

        <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.16em] text-[#e7c373]">Profile photo</p>
        <div className="mt-3 rounded-2xl border border-[#e1b55d]/32 bg-[#1a1428]/95 p-4 text-[13px] leading-relaxed text-[#e4d8f0]">
          <p>
            Within <span className="font-semibold text-[#fff6e8]">5 days of account approval</span>, add a profile photo
            that clearly shows <span className="font-semibold text-[#fff6e8]">you</span> — not logos, memes, pets, or other
            unrelated images.
          </p>
          <ul className="mt-3 space-y-2 list-disc pl-5 text-[#cbb89a]">
            <li>
              <span className="font-semibold text-[#fff6e8]">Have played on the platform?</span> You are not subject to
              suspension or removal for missing a profile photo.
            </li>
            <li>
              <span className="font-semibold text-[#fff6e8]">Have not played yet?</span> You must upload an acceptable
              profile photo within 5 days of approval. Accounts that do not may be suspended or removed.
            </li>
          </ul>
        </div>

        <p className="mt-5 text-[12px] leading-relaxed text-[#cbb89a] border-l-2 border-[#e7b84a]/60 pl-3.5">
          Relay may suspend or restrict accounts that break these program rules, abuse the platform, or put other
          members at risk. We exercise this only when we believe it is necessary to keep Relay fair and safe for
          everyone.
        </p>
        <div className="mt-5 space-y-3 rounded-2xl border border-[#e1b55d]/32 bg-[#1a1428]/95 p-4 text-[13px] leading-relaxed text-[#cbb89a]">
          <p>
            Problem with installation? Check out the <DownloadGuideLink />.
          </p>
          <p>
            For more information, open <span className="font-semibold text-[#f0c86a]">Chat</span> from the bar below
            and message our team.
          </p>
        </div>
      </main>

      <CustomerMobileFooterNav isLight={false} tone="gold" onChatClick={() => router.push('/feed?openChat=1')} />
    </div>
  )
}

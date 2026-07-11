'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

/** Lazy-load the heavy dashboard shell so the route chunk stays small (avoids dev ChunkLoadError). */
const DashboardPageClient = dynamic(() => import('./DashboardPageClient'), {
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-[#050814]">
      <Loader2 className="w-8 h-8 animate-spin text-[#8d63ff]" aria-hidden />
      <span className="sr-only">Loading dashboard…</span>
    </div>
  ),
})

export default function DashboardPage() {
  return <DashboardPageClient />
}

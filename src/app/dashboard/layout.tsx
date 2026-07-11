import { ChunkLoadRecovery } from '@/components/ChunkLoadRecovery'

/** Client dashboard is heavy; avoid static prefetch assumptions for this segment. */
export const dynamic = 'force-dynamic'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChunkLoadRecovery />
      {children}
    </>
  )
}

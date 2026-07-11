'use client'

import { RefreshCw } from 'lucide-react'
import clsx from 'clsx'

type Props = {
  onRefresh: () => void | Promise<void>
  busy?: boolean
  isLight?: boolean
  /** compact = feed header; plain = notifications bar; panel = messages panel on gradient. */
  variant?: 'compact' | 'plain' | 'panel'
  className?: string
  'aria-label'?: string
}

export function CustomerRefreshButton({
  onRefresh,
  busy = false,
  isLight = false,
  variant = 'compact',
  className,
  'aria-label': ariaLabel = 'Refresh',
}: Props) {
  const compact = variant === 'compact'
  const panel = variant === 'panel'

  return (
    <button
      type="button"
      onClick={() => void onRefresh()}
      disabled={busy}
      className={clsx(
        compact
          ? `relative flex h-10 w-10 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
              isLight
                ? 'bg-white text-slate-600 border-slate-200/90 hover:bg-slate-50'
                : 'bg-white/[0.06] text-[#d8def5] border-white/[0.08] hover:bg-white/[0.11]'
            }`
          : panel
            ? 'p-2 rounded-full text-white hover:bg-white/20 shrink-0 disabled:opacity-50'
            : 'p-2 rounded-full text-[#b8c0dc] hover:bg-white/10 disabled:opacity-50',
        className
      )}
      aria-label={ariaLabel}
    >
      <RefreshCw
        className={clsx(compact ? 'w-[18px] h-[18px]' : 'w-5 h-5', busy && 'animate-spin')}
        strokeWidth={2}
      />
    </button>
  )
}

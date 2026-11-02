import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'

type ChatJumpToLatestButtonProps = {
  visible: boolean
  onClick: () => void
  className?: string
  tone?: 'violet' | 'gold'
}

export function ChatJumpToLatestButton({ visible, onClick, className, tone = 'violet' }: ChatJumpToLatestButtonProps) {
  if (!visible) return null
  const gold = tone === 'gold'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Jump to latest messages"
      className={clsx(
        'absolute bottom-3 right-3 z-10',
        'flex h-9 w-9 items-center justify-center rounded-full shadow-lg backdrop-blur-sm',
        'transition hover:scale-105',
        'focus:outline-none focus-visible:ring-2',
        gold
          ? 'border border-[#e1b55d]/45 bg-[#1a1428]/95 text-[#f9d587] hover:bg-[#2a2118] focus-visible:ring-[#e7b84a]'
          : 'border border-white/15 bg-[#1a2748]/95 text-white hover:bg-[#243056] focus-visible:ring-[#8d63ff]',
        className
      )}
    >
      <ChevronDown className="h-5 w-5" strokeWidth={2.25} aria-hidden />
    </button>
  )
}

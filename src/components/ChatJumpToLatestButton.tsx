import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'

type ChatJumpToLatestButtonProps = {
  visible: boolean
  onClick: () => void
  className?: string
}

export function ChatJumpToLatestButton({ visible, onClick, className }: ChatJumpToLatestButtonProps) {
  if (!visible) return null

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Jump to latest messages"
      className={clsx(
        'absolute bottom-3 right-3 z-10',
        'flex h-9 w-9 items-center justify-center rounded-full',
        'border border-white/15 bg-[#1a2748]/95 text-white shadow-lg backdrop-blur-sm',
        'transition hover:scale-105 hover:bg-[#243056]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8d63ff]',
        className
      )}
    >
      <ChevronDown className="h-5 w-5" strokeWidth={2.25} aria-hidden />
    </button>
  )
}

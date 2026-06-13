'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { ImageLightbox } from '@/components/ImageLightbox'
import { useMessageImageSrc } from '@/hooks/useMessageImageSrc'
import { replyPreviewText } from '@/lib/customerMessaging'

type ImageProps = {
  imageUrl: string
  alt?: string
  className?: string
  linkClassName?: string
}

/** Renders a chat attachment; opens in an in-app lightbox instead of navigating away. */
export function ChatMessageImage({ imageUrl, alt = 'Attachment', className, linkClassName }: ImageProps) {
  const src = useMessageImageSrc(imageUrl)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className={linkClassName ?? 'block cursor-pointer'}
        aria-label="View image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={className} />
      </button>
      <ImageLightbox src={src} alt={alt} open={lightboxOpen} onClose={() => setLightboxOpen(false)} />
    </>
  )
}

type QuoteVariant = 'customer-mine' | 'customer-other' | 'staff-out' | 'staff-in'

type QuoteProps = {
  authorLabel: string
  body: string
  imageUrl?: string | null
  variant: QuoteVariant
  className?: string
  onClick?: () => void
}

const QUOTE_BAR: Record<QuoteVariant, string> = {
  'customer-mine': 'bg-white/70',
  'customer-other': 'bg-[#8d63ff]',
  'staff-out': 'bg-white/60',
  'staff-in': 'bg-[#6f54ff]',
}

const QUOTE_BG: Record<QuoteVariant, string> = {
  'customer-mine': 'bg-black/15',
  'customer-other': 'bg-black/25',
  'staff-out': 'bg-black/15',
  'staff-in': 'bg-black/30',
}

const QUOTE_AUTHOR: Record<QuoteVariant, string> = {
  'customer-mine': 'text-white/90',
  'customer-other': 'text-[#c4b8ff]',
  'staff-out': 'text-white/90',
  'staff-in': 'text-[#aeb7ff]',
}

const QUOTE_BODY: Record<QuoteVariant, string> = {
  'customer-mine': 'text-white/75',
  'customer-other': 'text-[#b8c0dc]',
  'staff-out': 'text-white/75',
  'staff-in': 'text-[#9ba6cb]',
}

/** Quoted message at the top of a reply bubble (Messenger / Teams style). */
export function MessageReplyQuote({ authorLabel, body, imageUrl, variant, className, onClick }: QuoteProps) {
  const preview = replyPreviewText(body, imageUrl)
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'flex gap-2 rounded-lg px-2.5 py-1.5 mb-1.5 text-left w-full min-w-0',
        QUOTE_BG[variant],
        onClick && 'cursor-pointer hover:brightness-110 transition-[filter]',
        className
      )}
    >
      <span className={clsx('w-0.5 shrink-0 rounded-full self-stretch min-h-[2rem]', QUOTE_BAR[variant])} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={clsx('block text-[11px] font-semibold truncate', QUOTE_AUTHOR[variant])}>{authorLabel}</span>
        <span className={clsx('block text-[12px] truncate', QUOTE_BODY[variant])}>{preview}</span>
      </span>
    </Tag>
  )
}

type ReplyBarProps = {
  authorLabel: string
  previewText: string
  onCancel: () => void
  className?: string
}

/** Composer strip while replying to a specific message. */
export function ReplyTargetBar({ authorLabel, previewText, onCancel, className }: ReplyBarProps) {
  return (
    <div
      className={clsx(
        'flex items-stretch gap-2 rounded-xl border border-[#8d63ff]/35 bg-[#8d63ff]/10 px-2.5 py-2',
        className
      )}
    >
      <span className="w-0.5 shrink-0 rounded-full bg-[#8d63ff] self-stretch" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-[#b8a6ff] truncate">Replying to {authorLabel}</p>
        <p className="text-[12px] text-[#9ba6cb] truncate">{previewText}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 p-1 rounded-full text-[#9ba6cb] hover:text-white hover:bg-white/10"
        aria-label="Cancel reply"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

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
  'customer-mine': 'bg-[#8a5a12]',
  'customer-other': 'bg-[#e7b84a]',
  'staff-out': 'bg-white/60',
  'staff-in': 'bg-[#6f54ff]',
}

const QUOTE_BG: Record<QuoteVariant, string> = {
  'customer-mine': 'bg-black/15',
  'customer-other': 'bg-black/25',
  'staff-out': 'bg-black/15',
  'staff-in': 'bg-white border border-slate-200',
}

const QUOTE_AUTHOR: Record<QuoteVariant, string> = {
  'customer-mine': 'text-[#3a2508]',
  'customer-other': 'text-[#f0c86a]',
  'staff-out': 'text-white/90',
  'staff-in': 'text-slate-700',
}

const QUOTE_BODY: Record<QuoteVariant, string> = {
  'customer-mine': 'text-[#5c3d12]',
  'customer-other': 'text-[#e4d8f0]',
  'staff-out': 'text-white/75',
  'staff-in': 'text-slate-600',
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
  tone?: 'light' | 'gold'
}

/** Composer strip while replying to a specific message. */
export function ReplyTargetBar({ authorLabel, previewText, onCancel, className, tone = 'light' }: ReplyBarProps) {
  const gold = tone === 'gold'
  return (
    <div
      className={clsx(
        'flex items-stretch gap-2 rounded-xl border px-2.5 py-2',
        gold ? 'border-[#e1b55d]/40 bg-[#2a2110]' : 'border-violet-200 bg-violet-50',
        className
      )}
    >
      <span className={clsx('w-0.5 shrink-0 rounded-full self-stretch', gold ? 'bg-[#e7b84a]' : 'bg-violet-500')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={clsx('text-[11px] font-semibold truncate', gold ? 'text-[#f0c86a]' : 'text-violet-800')}>
          Replying to {authorLabel}
        </p>
        <p className={clsx('text-[12px] truncate', gold ? 'text-[#e4d8f0]' : 'text-slate-600')}>{previewText}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className={clsx(
          'shrink-0 p-1 rounded-full',
          gold ? 'text-[#cbb89a] hover:text-[#fff6e8] hover:bg-white/10' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
        )}
        aria-label="Cancel reply"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

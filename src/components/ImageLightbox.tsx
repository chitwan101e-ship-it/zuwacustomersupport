'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

type Props = {
  src: string
  alt?: string
  open: boolean
  onClose: () => void
}

export function ImageLightbox({ src, alt = 'Image', open, onClose }: Props) {
  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-black/70"
        aria-label="Close image"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-[min(90dvh,calc(100dvh-2rem))] max-w-[min(95vw,1200px)] object-contain select-none"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>
  )
}

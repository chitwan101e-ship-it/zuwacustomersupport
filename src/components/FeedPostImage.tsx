'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { ImageLightbox } from '@/components/ImageLightbox'
import { useMessageImageSrc } from '@/hooks/useMessageImageSrc'

type Props = {
  imageUrl: string
  alt?: string
  rounded?: 'xl' | '2xl'
  className?: string
  /** Full width of the post, no inner rounding. */
  edge?: boolean
  /** Shorter image for older posts. */
  compact?: boolean
}

/** Feed announcement image — keeps aspect ratio and scales for mobile + desktop. */
export function FeedPostImage({ imageUrl, alt = '', rounded = '2xl', className, edge = false, compact = false }: Props) {
  const src = useMessageImageSrc(imageUrl)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const roundedClass = edge ? '' : rounded === 'xl' ? 'rounded-xl' : 'rounded-2xl'

  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className={clsx(
          'flex w-full items-center justify-center overflow-hidden bg-black/20 cursor-pointer',
          edge ? 'border-y border-white/10' : 'border border-white/10',
          roundedClass,
          className
        )}
        aria-label="View image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className={clsx(
            'mx-auto block h-auto w-full max-w-full object-contain',
            compact ? 'max-h-52' : 'max-h-[min(420px,75vw)] sm:max-h-[480px] md:max-h-[520px] lg:max-h-[560px]'
          )}
        />
      </button>
      <ImageLightbox src={src} alt={alt} open={lightboxOpen} onClose={() => setLightboxOpen(false)} />
    </>
  )
}

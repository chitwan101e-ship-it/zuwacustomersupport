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
}

/** Feed announcement image — keeps aspect ratio and scales for mobile + desktop. */
export function FeedPostImage({ imageUrl, alt = '', rounded = '2xl', className }: Props) {
  const src = useMessageImageSrc(imageUrl)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const roundedClass = rounded === 'xl' ? 'rounded-xl' : 'rounded-2xl'

  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className={clsx(
          'flex w-full items-center justify-center overflow-hidden border border-white/10 bg-black/20 cursor-pointer',
          roundedClass,
          className
        )}
        aria-label="View image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="mx-auto block h-auto w-auto max-w-full object-contain max-h-[min(420px,75vw)] sm:max-h-[480px] md:max-h-[520px] lg:max-h-[560px]"
        />
      </button>
      <ImageLightbox src={src} alt={alt} open={lightboxOpen} onClose={() => setLightboxOpen(false)} />
    </>
  )
}

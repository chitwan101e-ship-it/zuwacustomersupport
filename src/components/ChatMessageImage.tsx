'use client'

import { useState } from 'react'
import { ImageLightbox } from '@/components/ImageLightbox'
import { useMessageImageSrc } from '@/hooks/useMessageImageSrc'

type Props = {
  imageUrl: string
  alt?: string
  className?: string
  linkClassName?: string
}

/** Renders a chat attachment; opens in an in-app lightbox instead of navigating away. */
export function ChatMessageImage({ imageUrl, alt = 'Attachment', className, linkClassName }: Props) {
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

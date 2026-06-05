'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { storagePathFromMessageImageUrl } from '@/lib/messageImageUrl'

/** Resolves a message-images URL to a displayable src (signed when needed). */
export function useMessageImageSrc(imageUrl: string) {
  const [src, setSrc] = useState(imageUrl)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let cancelled = false
    setSrc(imageUrl)

    const path = storagePathFromMessageImageUrl(imageUrl)
    if (!path) return

    void (async () => {
      const { data, error } = await supabase.storage.from('message-images').createSignedUrl(path, 3600)
      if (cancelled || error || !data?.signedUrl) return
      setSrc(data.signedUrl)
    })()

    return () => {
      cancelled = true
    }
  }, [imageUrl, supabase])

  return src
}

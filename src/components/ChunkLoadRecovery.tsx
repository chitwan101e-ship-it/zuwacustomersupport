'use client'

import { useEffect } from 'react'

/** Reload once when a stale webpack chunk fails to load (common after dev rebuilds). */
export function ChunkLoadRecovery() {
  useEffect(() => {
    const key = 'relay-chunk-reload'

    function maybeReload(reason: string) {
      if (!/ChunkLoadError|Loading chunk .* failed/i.test(reason)) return
      if (sessionStorage.getItem(key) === '1') return
      sessionStorage.setItem(key, '1')
      window.location.reload()
    }

    const onError = (event: ErrorEvent) => {
      maybeReload(event.message || '')
    }

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      if (reason instanceof Error) maybeReload(reason.message)
      else if (typeof reason === 'string') maybeReload(reason)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}

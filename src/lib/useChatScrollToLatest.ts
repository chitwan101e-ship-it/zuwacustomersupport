import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

const NEAR_BOTTOM_THRESHOLD_PX = 80

function computeNearBottom(el: HTMLElement, threshold = NEAR_BOTTOM_THRESHOLD_PX) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}

export function useChatScrollToLatest(
  scrollRef: RefObject<HTMLElement | null>,
  watchKey?: string | null
) {
  const [showJumpButton, setShowJumpButton] = useState(false)
  const isNearBottomRef = useRef(true)

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const near = computeNearBottom(el)
    isNearBottomRef.current = near
    setShowJumpButton(!near)
  }, [scrollRef])

  const onScroll = useCallback(() => {
    updateScrollState()
  }, [updateScrollState])

  useEffect(() => {
    isNearBottomRef.current = true
    setShowJumpButton(false)
  }, [watchKey])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => updateScrollState())
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollRef, watchKey, updateScrollState])

  const markAtLatest = useCallback(() => {
    isNearBottomRef.current = true
    setShowJumpButton(false)
  }, [])

  const jumpToLatest = useCallback((scrollToLatest: (behavior?: ScrollBehavior) => void) => {
    scrollToLatest('smooth')
    isNearBottomRef.current = true
    setShowJumpButton(false)
  }, [])

  return { showJumpButton, onScroll, jumpToLatest, markAtLatest, isNearBottomRef }
}

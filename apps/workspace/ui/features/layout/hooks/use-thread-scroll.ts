import { useCallback, useEffect, useRef, useState } from 'react'
import type { GlideHandle } from '../lib/glide-scroll'
import { rememberThreadPosition, type ThreadPosition } from '../lib/thread-positions'
import {
  GESTURE_SETTLE_MS,
  READER_SCROLL_MS,
  UNSEEN_SLACK_PX,
  layoutTop,
  visibleBottom,
} from '../components/chat-area/chat-area-helpers'

export function useThreadScrollState() {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const lastReaderInputRef = useRef(0)
  const lastScrollHeightRef = useRef(0)
  const touchActiveRef = useRef(false)
  const jumpedRef = useRef(false)
  const followRafRef = useRef(0)
  const glideRef = useRef<GlideHandle | null>(null)
  const retryAtRef = useRef(-Infinity)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const anchorSpacerRef = useRef<HTMLDivElement>(null)
  const anchoredRef = useRef(false)
  const deepLinkedConversationRef = useRef<string | undefined>(undefined)
  const shownConversationIdRef = useRef<string | undefined>(undefined)
  const positionRafRef = useRef(0)
  return {
    scrollContainerRef,
    contentRef,
    followRef,
    lastReaderInputRef,
    lastScrollHeightRef,
    touchActiveRef,
    jumpedRef,
    followRafRef,
    glideRef,
    retryAtRef,
    showScrollButton,
    setShowScrollButton,
    anchorSpacerRef,
    anchoredRef,
    deepLinkedConversationRef,
    shownConversationIdRef,
    positionRafRef,
  }
}

export type ThreadScrollState = ReturnType<typeof useThreadScrollState>

export function useThreadFollow(
  scroll: ThreadScrollState,
  {
    activeConversationId,
    listReady,
    isEmpty,
    isTargetPending,
    turnLiveRef,
    stepsPhaseRef,
    reducedMotionRef,
  }: {
    activeConversationId: string | undefined
    listReady: boolean
    isEmpty: boolean
    isTargetPending: () => boolean
    turnLiveRef: { current: boolean }
    stepsPhaseRef: { current: boolean }
    reducedMotionRef: { current: boolean }
  }
) {
  const {
    scrollContainerRef,
    contentRef,
    anchorSpacerRef,
    anchoredRef,
    followRef,
    jumpedRef,
    glideRef,
    lastReaderInputRef,
    lastScrollHeightRef,
    touchActiveRef,
    followRafRef,
    shownConversationIdRef,
    positionRafRef,
    setShowScrollButton,
  } = scroll

  const unseenBelow = useCallback((): number => {
    const container = scrollContainerRef.current
    const spacer = anchorSpacerRef.current
    if (!container || !spacer) return 0
    return spacer.getBoundingClientRect().top - visibleBottom(container)
  }, [])

  const scrollToContentEnd = useCallback(
    (behavior: ScrollBehavior) => {
      const el = scrollContainerRef.current
      if (!el) return
      const delta = unseenBelow()
      if (Math.abs(delta) < 1) return
      el.scrollTo({ top: el.scrollTop + delta, behavior })
    },
    [unseenBelow]
  )

  const updateScrollButton = useCallback(() => {
    const show = !stepsPhaseRef.current && !followRef.current && unseenBelow() > UNSEEN_SLACK_PX
    setShowScrollButton((prev) => (prev === show ? prev : show))
  }, [unseenBelow])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const touched = () => {
      lastReaderInputRef.current = performance.now()
    }
    const touchStart = () => {
      touchActiveRef.current = true
      touched()
    }
    const touchEnd = () => {
      touchActiveRef.current = false
      touched()
    }
    const events = ['wheel', 'touchmove', 'pointerdown'] as const
    for (const type of events) container.addEventListener(type, touched, { passive: true })
    container.addEventListener('touchstart', touchStart, { passive: true })
    container.addEventListener('touchend', touchEnd, { passive: true })
    container.addEventListener('touchcancel', touchEnd, { passive: true })
    window.addEventListener('keydown', touched)
    return () => {
      for (const type of events) container.removeEventListener(type, touched)
      container.removeEventListener('touchstart', touchStart)
      container.removeEventListener('touchend', touchEnd)
      container.removeEventListener('touchcancel', touchEnd)
      window.removeEventListener('keydown', touched)
    }
  }, [isEmpty, listReady])

  const capturePosition = useCallback((): ThreadPosition | null => {
    const container = scrollContainerRef.current
    const content = contentRef.current
    if (!container || !content) return null
    if (unseenBelow() <= UNSEEN_SLACK_PX) return { atEnd: true }
    const top = container.getBoundingClientRect().top
    for (const row of content.querySelectorAll<HTMLElement>(':scope > [id^="message-"]')) {
      const rect = row.getBoundingClientRect()
      if (rect.bottom <= top) continue
      return { atEnd: false, messageId: row.id.slice('message-'.length), offsetTop: rect.top - top }
    }
    return null
  }, [unseenBelow])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const now = performance.now()
    const heightChanged = el.scrollHeight !== lastScrollHeightRef.current
    lastScrollHeightRef.current = el.scrollHeight
    const readerDriven = !heightChanged && now - lastReaderInputRef.current < READER_SCROLL_MS
    if (readerDriven) {
      lastReaderInputRef.current = now
      const atEnd = unseenBelow() <= 80
      followRef.current = atEnd && (!anchoredRef.current || jumpedRef.current)
    }
    updateScrollButton()
    const conversationId = shownConversationIdRef.current
    if (!conversationId || positionRafRef.current) return
    positionRafRef.current = requestAnimationFrame(() => {
      positionRafRef.current = 0
      if (shownConversationIdRef.current !== conversationId) return
      const position = capturePosition()
      if (position) rememberThreadPosition(conversationId, position)
    })
  }, [unseenBelow, updateScrollButton, capturePosition])

  const fitAnchorSpacer = useCallback(() => {
    const container = scrollContainerRef.current
    const spacer = anchorSpacerRef.current
    if (!anchoredRef.current || !container || !spacer) return
    const target = container.querySelector<HTMLElement>('[data-chat-anchor="true"]')
    if (!target) return
    const padding =
      Number.parseFloat(getComputedStyle(spacer.parentElement ?? spacer).paddingBottom) || 0
    const filled = spacer.getBoundingClientRect().top - layoutTop(target)
    const room = `${Math.max(0, Math.round(container.clientHeight - filled - padding))}px`
    if (spacer.style.minHeight !== room) spacer.style.minHeight = room
  }, [])

  useEffect(() => {
    const content = contentRef.current
    const viewport = scrollContainerRef.current
    if (!content) return
    let lastHeight = content.getBoundingClientRect().height
    const observer = new ResizeObserver((entries) => {
      let height = lastHeight
      let viewportResized = false
      for (const entry of entries) {
        if (entry.target === content) height = entry.contentRect.height
        else if (entry.target === viewport) viewportResized = true
      }
      const grew = height > lastHeight
      lastHeight = height
      fitAnchorSpacer()
      if (followRef.current && (grew || viewportResized) && !isTargetPending()) {
        cancelAnimationFrame(followRafRef.current)
        followRafRef.current = requestAnimationFrame(() => {
          if (!followRef.current) return
          const handOnScroll =
            touchActiveRef.current ||
            performance.now() - lastReaderInputRef.current < GESTURE_SETTLE_MS
          if (handOnScroll) return
          scrollToContentEnd(turnLiveRef.current || reducedMotionRef.current ? 'auto' : 'smooth')
        })
      }
      updateScrollButton()
    })
    observer.observe(content)
    if (viewport) observer.observe(viewport)
    const composerWatch = new MutationObserver(() => fitAnchorSpacer())
    for (let host = viewport?.parentElement; host; host = host.parentElement) {
      composerWatch.observe(host, { attributes: true, attributeFilter: ['style'] })
    }
    return () => {
      cancelAnimationFrame(followRafRef.current)
      observer.disconnect()
      composerWatch.disconnect()
    }
  }, [
    scrollToContentEnd,
    fitAnchorSpacer,
    updateScrollButton,
    isTargetPending,
    isEmpty,
    listReady,
    activeConversationId,
  ])

  useEffect(() => () => glideRef.current?.stop(), [])

  const handleScrollToLatest = useCallback(() => {
    glideRef.current?.stop()
    followRef.current = true
    jumpedRef.current = true
    setShowScrollButton(false)
    scrollToContentEnd(reducedMotionRef.current ? 'auto' : 'smooth')
  }, [scrollToContentEnd])

  return { handleScroll, handleScrollToLatest, fitAnchorSpacer }
}

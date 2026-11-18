import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { glideScrollTo } from '../lib/glide-scroll'
import { readThreadPosition } from '../lib/thread-positions'
import {
  RETRY_ANCHOR_WINDOW_MS,
  UNSEEN_SLACK_PX,
  layoutTop,
  visibleBottom,
} from '../components/chat-area/chat-area-helpers'
import type { ThreadScrollState } from './use-thread-scroll'

export function useThreadAnchor(
  scroll: ThreadScrollState,
  {
    conversationId,
    listReady,
    isEmpty,
    currentUserMessageId,
    lastQuestionId,
    unreadDividerBeforeId,
    isForeignTurn,
    spectatingLive,
    turnLiveRef,
    reducedMotionRef,
    isTargetPending,
    fitAnchorSpacer,
  }: {
    conversationId: string | undefined
    listReady: boolean
    isEmpty: boolean
    currentUserMessageId: string | null | undefined
    lastQuestionId: string | null
    unreadDividerBeforeId: string | null
    isForeignTurn: boolean
    spectatingLive: boolean
    turnLiveRef: { current: boolean }
    reducedMotionRef: { current: boolean }
    isTargetPending: () => boolean
    fitAnchorSpacer: () => void
  }
) {
  const {
    scrollContainerRef,
    anchorSpacerRef,
    anchoredRef,
    followRef,
    followRafRef,
    jumpedRef,
    glideRef,
    retryAtRef,
    deepLinkedConversationRef,
    shownConversationIdRef,
    positionRafRef,
    setShowScrollButton,
  } = scroll

  const spectatorLive = isForeignTurn && spectatingLive
  const [spectatorAnchor, setSpectatorAnchor] = useState<{
    id: string
    sentId: string | null | undefined
  } | null>(null)
  const sawQuestionArrive = useCallback((questionId: string): boolean => {
    const container = scrollContainerRef.current
    const row = document.getElementById(`message-${questionId}`)
    if (!container || !row || !container.contains(row)) return false
    return layoutTop(row) - visibleBottom(container) <= UNSEEN_SLACK_PX
  }, [])
  useEffect(() => {
    const questionId = lastQuestionId
    if (!spectatorLive || !questionId) return
    if (!followRef.current && !(anchoredRef.current && sawQuestionArrive(questionId))) return
    setSpectatorAnchor((previous) =>
      previous?.id === questionId ? previous : { id: questionId, sentId: currentUserMessageId }
    )
  }, [spectatorLive, lastQuestionId, currentUserMessageId, sawQuestionArrive])
  const anchorId =
    spectatorAnchor && spectatorAnchor.sentId === currentUserMessageId
      ? spectatorAnchor.id
      : currentUserMessageId
  const prevAnchorIdRef = useRef<string | null | undefined>(anchorId)

  useLayoutEffect(() => {
    const id = anchorId
    if (!id || id === prevAnchorIdRef.current) return
    prevAnchorIdRef.current = id
    const container = scrollContainerRef.current
    if (!container?.querySelector('[data-chat-anchor="true"]')) return
    followRef.current = false
    jumpedRef.current = false
    cancelAnimationFrame(followRafRef.current)
    glideRef.current?.stop()
    setShowScrollButton(false)
    anchoredRef.current = true
    fitAnchorSpacer()
    const retry = performance.now() - retryAtRef.current < RETRY_ANCHOR_WINDOW_MS
    const raf = requestAnimationFrame(() => {
      const target = container.querySelector<HTMLElement>('[data-chat-anchor="true"]')
      if (!target) return
      fitAnchorSpacer()
      const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0
      const top =
        container.scrollTop + layoutTop(target) - container.getBoundingClientRect().top - margin
      if (retry && Math.abs(top - container.scrollTop) < container.clientHeight) return
      if (Math.abs(top - container.scrollTop) < 1) return
      glideRef.current = glideScrollTo(container, top, {
        reducedMotion: reducedMotionRef.current,
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [anchorId, fitAnchorSpacer])

  const positionedConversationRef = useRef<string | null | undefined>(null)
  useLayoutEffect(() => {
    const id = conversationId
    if (shownConversationIdRef.current !== id) {
      const createdBySend = shownConversationIdRef.current === undefined && anchoredRef.current
      shownConversationIdRef.current = id
      cancelAnimationFrame(positionRafRef.current)
      positionRafRef.current = 0
      if (createdBySend) {
        positionedConversationRef.current = id
        return
      }
      glideRef.current?.stop()
      followRef.current = true
      jumpedRef.current = false
      setShowScrollButton(false)
      anchoredRef.current = false
      setSpectatorAnchor(null)
      if (anchorSpacerRef.current) anchorSpacerRef.current.style.minHeight = '0px'
      positionedConversationRef.current = null
      deepLinkedConversationRef.current = undefined
    }
    const container = scrollContainerRef.current
    if (!id || !listReady || isEmpty || !container || positionedConversationRef.current === id)
      return
    positionedConversationRef.current = id

    if (isTargetPending() || deepLinkedConversationRef.current === id) {
      followRef.current = false
      return
    }
    const viewportTop = container.getBoundingClientRect().top
    const rowTop = (rowId: string, { clearToolbar }: { clearToolbar: boolean }): number | null => {
      const row = document.getElementById(`message-${rowId}`)
      if (!row || !container.contains(row)) return null
      const margin = clearToolbar
        ? Number.parseFloat(getComputedStyle(row).scrollMarginTop) || 0
        : 0
      return container.scrollTop + layoutTop(row) - viewportTop - margin
    }
    const openAt = (top: number, { follow }: { follow: boolean } = { follow: false }) => {
      followRef.current = follow
      if (Math.abs(container.scrollTop - top) >= 1) container.scrollTop = top
    }
    const liveQuestion =
      turnLiveRef.current && anchorId ? rowTop(anchorId, { clearToolbar: true }) : null
    if (liveQuestion !== null) {
      anchoredRef.current = true
      fitAnchorSpacer()
    }
    if (unreadDividerBeforeId) {
      const top = rowTop(unreadDividerBeforeId, { clearToolbar: true })
      if (top !== null) return openAt(top)
    }
    const saved = readThreadPosition(id)
    if (saved && !saved.atEnd) {
      const top = rowTop(saved.messageId, { clearToolbar: false })
      if (top !== null) return openAt(top - saved.offsetTop)
    }
    if (liveQuestion !== null) return openAt(liveQuestion)
    const end = container.scrollHeight - container.clientHeight
    const lastQuestion = saved ? null : lastQuestionId
    const questionTop = lastQuestion ? rowTop(lastQuestion, { clearToolbar: true }) : null
    if (questionTop !== null && questionTop < end) openAt(Math.max(0, questionTop))
    else openAt(end, { follow: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, listReady, isEmpty])

  return { anchorId }
}

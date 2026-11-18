'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Crosshair } from 'lucide-react'
import { AnimatePresence, motion, motionBase } from '@/components/motion'
import { COMMENT_PIN_ON_POINT, CommentPin } from '@/components/ui/comment-pin'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { isGhostMark, isLive } from '@/lib/annotations/types'
import { cn } from '@/lib/utils'
import { askRegionOf, type CanvasAsk } from '../../hooks/use-canvas-ask'
import type { DocumentReview, ReviewDraft, ReviewTool } from '../../hooks/use-document-review'
import { sameItems, useStoreSelector } from '@/features/realtime/use-channel'
import type { ShownHighlight } from '../../hooks/use-document-room'
import { usePeerSelections } from '../../hooks/use-peer-selections'
import { at, box, onPage, placeCard, pointIn, tagFitsAbove, type CardAnchor } from '../../lib/review-overlay-geometry'
import { PageCompany } from './review-page-layer/page-company'
import { PageMarks } from './review-page-layer/page-marks'

export {
  AGENT_REST_MS,
  agentCursorLabel,
  agentForShort,
  agentResting,
  CURSOR_IDLE_MS,
  isAgentPeer,
  peerSelections,
} from '../../lib/review-peer-state'
export { useRestedFor } from '../../hooks/use-rested-for'
export {
  CARD_SPAN,
  CARD_WIDTH,
  draftTagPlace,
  placeCard,
  SELECTION_TAG_NEAR,
  selectionTagged,
} from '../../lib/review-overlay-geometry'
export type { CardAnchor, CardSide } from '../../lib/review-overlay-geometry'
export { markInk } from './review-page-layer/page-marks'
export { pinLabel } from '../../lib/review-pin-label'

const MIN_REGION = 0.012

const POINT_SLOP = 8

const roomTool = (tool: ReviewTool) => (tool === 'ask' ? 'region' : tool)

function KeyboardAim({
  page,
  tool,
  startY,
  onSet,
}: {
  page: number
  tool: Exclude<ReviewTool, 'select'>
  startY: number
  onSet: (draft: ReviewDraft) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const surface = useRef<HTMLDivElement | null>(null)
  const marker = useRef<HTMLSpanElement | null>(null)
  const [point, setPoint] = useState({ x: 0.5, y: onPage(startY) })
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => surface.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => {
    marker.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [point])
  const STEPS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction = STEPS[event.key]
    if (direction) {
      event.preventDefault()
      event.stopPropagation()
      const step = event.shiftKey ? 0.05 : 0.01
      setPoint((current) => ({ x: onPage(current.x + direction[0] * step), y: onPage(current.y + direction[1] * step) }))
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    if (tool === 'point') {
      onSet({ page, shape: 'point', x: point.x, y: point.y, w: null, h: null })
      return
    }
    if (!anchor) {
      setAnchor(point)
      return
    }
    const w = onPage(Math.abs(point.x - anchor.x))
    const h = onPage(Math.abs(point.y - anchor.y))
    onSet(
      w < MIN_REGION || h < MIN_REGION
        ? { page, shape: 'point', x: anchor.x, y: anchor.y, w: null, h: null }
        : { page, shape: 'region', x: Math.min(anchor.x, point.x), y: Math.min(anchor.y, point.y), w, h }
    )
  }
  const percent = (value: number) => Math.round(value * 100)
  return (
    <div
      ref={surface}
      role="application"
      tabIndex={-1}
      aria-label={t(`review.aim.label.${tool}`)}
      aria-describedby={`review-aim-where-${page}`}
      data-testid="review-aim"
      data-anchored={anchor ? true : undefined}
      onKeyDown={onKeyDown}
      className="focus-visible:ring-ring/60 pointer-events-none absolute inset-0 z-30 rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-inset"
    >
      {anchor && (
        <span
          aria-hidden
          data-testid="review-aim-box"
          className="border-paper-ink absolute rounded-[2px] border-2 border-dashed"
          style={{
            ...box(Math.min(anchor.x, point.x), Math.min(anchor.y, point.y), Math.abs(point.x - anchor.x), Math.abs(point.y - anchor.y)),
            backgroundColor: 'color-mix(in oklch, var(--paper-ink) 6%, transparent)',
          }}
        />
      )}
      <span
        ref={marker}
        aria-hidden
        data-testid="review-aim-cross"
        className="text-paper-ink absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-current bg-white/40"
        style={at(point.x, point.y)}
      >
        <Crosshair className="size-5" strokeWidth={2.25} />
      </span>
      <span id={`review-aim-where-${page}`} className="sr-only" aria-live="polite">
        {anchor
          ? t('review.aim.box', {
              w: percent(Math.abs(point.x - anchor.x)),
              h: percent(Math.abs(point.y - anchor.y)),
            })
          : t('review.aim.where', { page, x: percent(point.x), y: percent(point.y) })}
      </span>
    </div>
  )
}

export function ReviewPageLayer({
  page,
  review,
  focused,
  onOpenMark,
  onPinByKeyboard,
  aim,
  renderThread,
  renderAsk,
}: {
  page: number
  review: DocumentReview
  focused: boolean
  onOpenMark?: (annotationId: string) => void
  onPinByKeyboard?: () => void
  aim?: { y: number; key: number } | null
  renderThread?: (anchor: CardAnchor) => JSX.Element | null
  renderAsk?: (ask: CanvasAsk, anchor: CardAnchor) => JSX.Element | null
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const pressRef = useRef<{ pointers: Set<number>; start: { x: number; y: number; clientX: number; clientY: number } | null; cancelled: boolean }>({
    pointers: new Set(),
    start: null,
    cancelled: false,
  })
  const { annotations, tool, draft, selectedId, hoveredId, room, filter, piloti: agent, select, setDraft, hover, unread } = review
  const { sendCursor, sendDraft } = room
  const selfUserId = room.self?.userId ?? null
  const highlights = useStoreSelector(
    room.highlights,
    useCallback((shown: readonly ShownHighlight[]) => shown.filter((highlight) => highlight.page === page), [page]),
    sameItems
  )
  const selections = usePeerSelections(room, selfUserId)

  useEffect(() => {
    const node = layerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) =>
      setSize((current) =>
        current.width === entry.contentRect.width && current.height === entry.contentRect.height
          ? current
          : { width: entry.contentRect.width, height: entry.contentRect.height }
      )
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const sheet = layerRef.current?.parentElement?.parentElement
    if (!sheet) return
    const move = (event: PointerEvent) => {
      const point = pointIn(sheet, event)
      if (point) sendCursor({ page, ...point }, roomTool(tool))
    }
    const leave = () => sendCursor(null, roomTool(tool))
    sheet.addEventListener('pointermove', move)
    sheet.addEventListener('pointerleave', leave)
    return () => {
      sheet.removeEventListener('pointermove', move)
      sheet.removeEventListener('pointerleave', leave)
    }
  }, [page, sendCursor, tool])

  const marks = useMemo(
    () =>
      annotations.filter(
        (annotation) =>
          annotation.page === page &&
          annotation.onCurrentRevision &&
          (isLive(annotation) || (focused && filter === 'closed') || annotation.id === selectedId)
      ),
    [annotations, page, focused, filter, selectedId]
  )
  const ghosts = useMemo(
    () =>
      focused && filter === 'open'
        ? annotations.filter((annotation) => annotation.page === page && isGhostMark(annotation, review.documentId))
        : [],
    [annotations, page, focused, filter, review.documentId]
  )
  const agentThinking = agent.asks.some((ask) => ask.status === 'thinking')
  const onPin = useCallback(
    (annotationId: string, byKeyboard: boolean) => {
      if (!focused) {
        onOpenMark?.(annotationId)
        return
      }
      const opening = annotationId !== selectedId
      if (opening && byKeyboard) onPinByKeyboard?.()
      setDraft(null)
      select(opening ? annotationId : null)
    },
    [focused, onOpenMark, onPinByKeyboard, selectedId, setDraft, select]
  )

  const backToNavigate = (pointerType: string) => {
    if (pointerType === 'touch' || pointerType === 'pen') review.setTool('select')
  }
  const cancelPress = () => {
    const press = pressRef.current
    press.cancelled = true
    setDrag(null)
    sendDraft(null)
  }
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool === 'select' || event.button !== 0) return
    const press = pressRef.current
    press.pointers.add(event.pointerId)
    if (press.pointers.size > 1) {
      cancelPress()
      return
    }
    const point = pointIn(event.currentTarget, event)
    if (!point) return
    press.cancelled = false
    press.start = { ...point, clientX: event.clientX, clientY: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
    review.select(null)
    if (tool === 'point') return
    setDrag({ x0: point.x, y0: point.y, x1: point.x, y1: point.y })
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || pressRef.current.cancelled) return
    const point = pointIn(event.currentTarget, event)
    if (!point) return
    setDrag({ ...drag, x1: point.x, y1: point.y })
    sendDraft({
      x: Math.min(drag.x0, point.x),
      y: Math.min(drag.y0, point.y),
      w: Math.abs(point.x - drag.x0),
      h: Math.abs(point.y - drag.y0),
    })
  }
  const place = (next: ReviewDraft) => {
    if (tool === 'ask') agent.compose(askRegionOf(next))
    else review.setDraft(next)
  }
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    press.pointers.delete(event.pointerId)
    const start = press.start
    const cancelled = press.cancelled || event.type === 'pointercancel'
    if (press.pointers.size > 0) return
    press.start = null
    if (cancelled || !start) {
      press.cancelled = false
      return
    }
    if (tool === 'point') {
      if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > POINT_SLOP) return
      review.setDraft({ page, shape: 'point', x: start.x, y: start.y, w: null, h: null })
      backToNavigate(event.pointerType)
      return
    }
    if (!drag) return
    const x = Math.min(drag.x0, drag.x1)
    const y = Math.min(drag.y0, drag.y1)
    const w = Math.round(Math.abs(drag.x1 - drag.x0) * 10_000) / 10_000
    const h = Math.round(Math.abs(drag.y1 - drag.y0) * 10_000) / 10_000
    setDrag(null)
    sendDraft(null)
    place(
      w < MIN_REGION || h < MIN_REGION
        ? { page, shape: 'point', x: drag.x0, y: drag.y0, w: null, h: null }
        : { page, shape: 'region', x, y, w, h }
    )
    backToNavigate(event.pointerType)
  }

  const selected = marks.find((annotation) => annotation.id === selectedId) ?? null
  const draftHere = draft?.page === page ? draft : null
  const asksHere = agent.asks.filter(
    (ask): ask is CanvasAsk & { region: NonNullable<CanvasAsk['region']> } =>
      !ask.replyInThread && ask.region?.page === page
  )
  const openAsk = focused ? (asksHere.find((ask) => ask.id === agent.openId) ?? null) : null
  const anchorOf = (place: { x: number; y: number; w: number | null; h?: number | null }) => placeCard(place, size)
  const threadPlace = draftHere ?? selected
  const threadAnchor = threadPlace ? anchorOf(threadPlace) : null
  const askAnchor = openAsk ? anchorOf(openAsk.region) : null

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0" data-testid={`review-layer-${page}`}>
      {/* The surface a tool works on. Over the text layer, so the click that
          sets a mark never starts a selection. */}
      {focused && tool !== 'select' && (
        <div
          data-testid="review-capture"
          aria-hidden
          data-zoom-tap="off"
          className="pointer-events-auto absolute inset-0 z-10 cursor-crosshair touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
      )}

      <PageMarks
        marks={ghosts}
        ghost
        unread={unread}
        focused={focused}
        selectedId={selectedId}
        hoveredId={hoveredId}
        selections={selections}
        onPin={onPin}
        onHover={hover}
      />
      <PageMarks
        marks={marks}
        unread={unread}
        focused={focused}
        selectedId={selectedId}
        hoveredId={hoveredId}
        selections={selections}
        onPin={onPin}
        onHover={hover}
      />

      {drag && (
        <span
          aria-hidden
          className="border-paper-ink absolute z-20 rounded-[3px] border-[1.5px] border-dashed"
          style={{
            ...box(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0)),
            backgroundColor: 'color-mix(in oklch, var(--paper-ink) 6%, transparent)',
          }}
        />
      )}

      {draftHere && (
        <>
          {draftHere.shape === 'region' && draftHere.w && draftHere.h && (
            <span
              aria-hidden
              data-testid="review-draft-region"
              className="border-paper-ink absolute z-20 rounded-[2px] border-2 mix-blend-multiply"
              style={{
                ...box(draftHere.x, draftHere.y, draftHere.w, draftHere.h),
                backgroundColor: 'color-mix(in oklch, var(--paper-ink) 6%, transparent)',
              }}
            />
          )}
          {draftHere.shape === 'point' && (
            <span className={cn('absolute z-20', COMMENT_PIN_ON_POINT)} style={at(draftHere.x, draftHere.y)}>
              <CommentPin as="span" active pending />
            </span>
          )}
        </>
      )}

      {asksHere.map((ask) => {
        const thinking = ask.status === 'thinking' || ask.status === 'composing'
        return (
          <div key={ask.id} className="contents">
            {/* The agent's ink, dashed: a question, not a mark. While the agent
                works a band of light travels across it. */}
            <span
              aria-hidden
              data-testid="agent-ask-box"
              data-status={ask.status}
              className={cn(
                'border-paper-ink absolute z-20 rounded-[3px] border-[1.5px] border-dashed',
                ask.status === 'thinking' && 'animate-skeleton-shimmer motion-reduce:animate-none'
              )}
              style={box(ask.region.x, ask.region.y, ask.region.w, ask.region.h)}
            />
            {ask.id !== openAsk?.id && focused && (
              <button data-attr="agent-ask-reopen"
                type="button"
                data-testid="agent-ask-reopen"
                aria-label={t('review.piloti.reopen')}
                title={t('review.piloti.reopen')}
                onClick={() => agent.open(ask.id)}
                className="pointer-events-auto absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                style={at(ask.region.x + ask.region.w, ask.region.y)}
              >
                {/* On the page: paper ink, which the theme does not flip. */}
                <AgentGlyph size="xs" working={thinking} className="bg-paper-ink text-paper-ink-foreground" />
              </button>
            )}
          </div>
        )
      })}

      <AnimatePresence>
        {highlights.map((highlight) => (
          <motion.span
            key={highlight.key}
            data-testid="agent-highlight"
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionBase}
            className="border-paper-ink absolute z-20 rounded-[3px] border-2 border-dashed"
            style={{
              ...box(highlight.x, highlight.y, highlight.w, highlight.h),
              backgroundColor: 'color-mix(in oklch, var(--paper-ink) 5%, transparent)',
            }}
          >
            {highlight.label && (
              <span
                data-testid="agent-highlight-label"
                className={cn(
                  'bg-paper-ink text-paper-ink-foreground absolute right-0 max-w-56 truncate px-1.5 py-0.5 text-[11px] leading-4 font-medium',
                  tagFitsAbove(highlight.y, size.height) ? '-top-px -translate-y-full rounded-t-[3px]' : 'top-0 rounded-bl-[3px]'
                )}
              >
                {highlight.label}
              </span>
            )}
          </motion.span>
        ))}
      </AnimatePresence>

      <PageCompany
        room={room}
        page={page}
        focused={focused}
        size={size}
        marks={marks}
        selfUserId={selfUserId}
        agentThinking={agentThinking}
      />

      {focused && aim && tool !== 'select' && !draft && (
        <KeyboardAim key={aim.key} page={page} tool={tool} startY={aim.y} onSet={place} />
      )}

      {openAsk && askAnchor && renderAsk && (
        <div className="pointer-events-auto absolute z-40" style={at(askAnchor.x, askAnchor.y)} data-placement={askAnchor.placement}>
          {renderAsk(openAsk, askAnchor)}
        </div>
      )}

      {!openAsk && focused && renderThread && threadAnchor && (
        <div
          className="pointer-events-auto absolute z-40"
          style={at(threadAnchor.x, threadAnchor.y)}
          data-placement={threadAnchor.placement}
        >
          {renderThread(threadAnchor)}
        </div>
      )}
    </div>
  )
}

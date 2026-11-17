'use client'

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Crosshair, Sparkles, SquareDashed } from 'lucide-react'
import { AnimatePresence, motion, motionBase, springGlide, useMotionToken } from '@/components/motion'
import { COMMENT_PIN_ON_POINT, CommentPin } from '@/components/ui/comment-pin'
import { identityInk } from '@/components/ui/avatar-identity'
import { LiveCursor } from '@/components/ui/live-cursor'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { WorkingDots } from '@/components/ui/working-dots'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { presenceCopy } from '@/i18n/namespaces/presence'
import { isGhostMark, isLive, type AnnotationView } from '@/lib/annotations/types'
import { cn } from '@/lib/utils'
import { askRegionOf, type CanvasAsk } from '../../hooks/use-canvas-ask'
import type { DocumentReview, ReviewDraft, ReviewTool } from '../../hooks/use-document-review'
import { sameItems, useStoreSelector } from '@/features/realtime/use-channel'
import {
  usePeersOnPage,
  useRoomSelector,
  type DocumentRoom,
  type RoomPeerState,
  type ShownHighlight,
} from '../../hooks/use-document-room'
import { useAgentByline } from './agent-attribution'
import { PRODUCT_NAME } from '@/lib/brand'

const MIN_REGION = 0.012

const POINT_SLOP = 8

const at = (x: number, y: number): CSSProperties => ({ left: `${x * 100}%`, top: `${y * 100}%` })
const box = (x: number, y: number, w: number, h: number): CSSProperties => ({
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  width: `${w * 100}%`,
  height: `${h * 100}%`,
})

const roomTool = (tool: ReviewTool) => (tool === 'ask' ? 'region' : tool)

export const isAgentPeer = (state: RoomPeerState): boolean => state.peer.kind === 'piloti'

export function agentForShort(peer: Pick<RoomPeerState['peer'], 'forName'>): string | null {
  const first = peer.forName?.trim().split(/\s+/)[0]?.split('@')[0]
  return first || null
}

function AgentCursor({ state, idle }: { state: RoomPeerState; idle?: boolean }): JSX.Element {
  const tPresence = useTranslations(presenceCopy)
  const forShort = agentForShort(state.peer)
  const dots = state.activity ? <WorkingDots className="ml-0.5" /> : undefined
  return (
    <LiveCursor
      color="var(--paper-ink)"
      idle={idle}
      label={agentCursorLabel(state, tPresence('piloti.reading', { page: state.activity?.box?.page ?? 1 }))}
      icon={<Sparkles className="size-3" aria-hidden />}
      busy={
        forShort ? (
          <>
            <span data-testid="agent-cursor-for" className="shrink-0">
              {tPresence('piloti.forSuffix', { name: forShort })}
            </span>
            {dots}
          </>
        ) : (
          dots
        )
      }
    />
  )
}

export function agentCursorLabel(state: Pick<RoomPeerState, 'label' | 'activity'>, reading: string): string {
  const doing = state.label || state.activity?.label || (state.activity?.state === 'reading' ? reading : null)
  return doing ? `${PRODUCT_NAME} · ${doing}` : PRODUCT_NAME
}

export function useRestedFor(movedAt: number | null, ms: number): boolean {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (movedAt === null) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, movedAt + ms - Date.now()) + 1)
    return () => clearTimeout(timer)
  }, [movedAt, ms])
  return movedAt !== null && now - movedAt > ms
}

export const CURSOR_IDLE_MS = 8_000

export const AGENT_REST_MS = 3_000

export function agentResting(
  state: Pick<RoomPeerState, 'activity' | 'movedAt'>,
  now: number,
  thinking: boolean
): boolean {
  return !thinking && !state.activity && state.movedAt !== null && now - state.movedAt > AGENT_REST_MS
}

export const CARD_WIDTH = 320
export const CARD_SPAN = CARD_WIDTH + 16

export type CardSide = 'right' | 'left' | 'below'

export interface CardAnchor {
  x: number
  y: number
  placement: CardSide
}

export function placeCard(
  mark: { x: number; y: number; w: number | null; h?: number | null },
  layer: { width: number; height: number },
  span = CARD_SPAN
): CardAnchor {
  const left = mark.x
  const right = mark.x + (mark.w ?? 0)
  if (!(layer.width > 0)) {
    const flip = 1 - right < left
    return { x: flip ? left : right, y: mark.y, placement: flip ? 'left' : 'right' }
  }
  if ((1 - right) * layer.width >= span) return { x: right, y: mark.y, placement: 'right' }
  if (left * layer.width >= span) return { x: left, y: mark.y, placement: 'left' }
  const cardWidth = span - (CARD_SPAN - CARD_WIDTH)
  const x = Math.max(0, Math.min(left * layer.width, layer.width - cardWidth)) / layer.width
  return { x, y: mark.y + (mark.h ?? 0), placement: 'below' }
}

export const SELECTION_TAG_NEAR = 48

export function selectionTagged(
  selectors: readonly RoomPeerState[],
  mark: Pick<AnnotationView, 'page' | 'x' | 'y' | 'w' | 'h'>,
  layer: { width: number; height: number },
  near = SELECTION_TAG_NEAR
): RoomPeerState[] {
  if (!(layer.width > 0 && layer.height > 0)) return [...selectors]
  const x1 = mark.x + (mark.w ?? 0)
  const y1 = mark.y + (mark.h ?? 0)
  return selectors.filter((state) => {
    const cursor = state.cursor
    if (!cursor || cursor.page !== mark.page) return true
    const dx = Math.max(mark.x - cursor.x, 0, cursor.x - x1) * layer.width
    const dy = Math.max(mark.y - cursor.y, 0, cursor.y - y1) * layer.height
    return Math.hypot(dx, dy) > near
  })
}

const tagFitsAbove = (y: number, height: number) => !(height > 0) || y * height >= 20

export function peerSelections(
  peers: readonly RoomPeerState[],
  selfUserId: string | null
): Map<string, RoomPeerState[]> {
  const byMark = new Map<string, RoomPeerState[]>()
  for (const state of peers) {
    if (!state.selected || isAgentPeer(state) || state.peer.userId === selfUserId) continue
    const here = byMark.get(state.selected) ?? []
    if (!here.some((other) => other.peer.userId === state.peer.userId)) byMark.set(state.selected, [...here, state])
  }
  return byMark
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0]?.split('@')[0] || name

function PeerSelection({
  annotation,
  selectors,
  tagged,
  pageHeight,
}: {
  annotation: Pick<AnnotationView, 'shape' | 'x' | 'y' | 'w' | 'h'>
  selectors: readonly RoomPeerState[]
  tagged: readonly RoomPeerState[]
  pageHeight: number
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const first = selectors[0]
  if (!first) return null
  const ink = identityInk(first.peer.userId)
  const names = tagged.map((state) => firstName(state.peer.name))
  const tag = names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]
  const region = annotation.shape === 'region' && annotation.w && annotation.h ? annotation : null
  const above = region ? tagFitsAbove(region.y, pageHeight) : true
  return (
    <>
      {region ? (
        <span
          aria-hidden
          data-testid="review-peer-selection"
          className="pointer-events-none absolute z-20 rounded-[3px]"
          style={{ ...box(region.x, region.y, region.w ?? 0, region.h ?? 0), outline: `2px solid ${ink}`, outlineOffset: 2 }}
        />
      ) : (
        <span
          aria-hidden
          data-testid="review-peer-selection"
          className="pointer-events-none absolute z-[9] size-8 -translate-x-1 -translate-y-7 rounded-full rounded-bl-none border-2"
          style={{ ...at(annotation.x, annotation.y), borderColor: ink }}
        />
      )}
      {tag && (
        <span
          className={cn(
            'pointer-events-none absolute z-20 rounded-full px-1.5 py-px text-[10px] leading-4 font-medium whitespace-nowrap text-background shadow-sm',
            region
              ? above
                ? '-translate-x-full -translate-y-[calc(100%+4px)]'
                : '-translate-x-[calc(100%+4px)] translate-y-1'
              : 'translate-x-8 -translate-y-6'
          )}
          style={{ ...at(region ? region.x + (region.w ?? 0) : annotation.x, annotation.y), backgroundColor: ink }}
          title={t('review.peerSelected', { names: selectors.map((state) => state.peer.name).join(', ') })}
          data-testid="review-peer-selection-tag"
        >
          {tag}
        </span>
      )}
    </>
  )
}

export function markInk(annotation: Pick<AnnotationView, 'authorKind' | 'createdBy'>): string {
  return annotation.authorKind === 'piloti' ? 'var(--paper-ink)' : identityInk(annotation.createdBy)
}

const onPage = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000

function pointIn(element: HTMLElement, event: { clientX: number; clientY: number }) {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { x: onPage((event.clientX - rect.left) / rect.width), y: onPage((event.clientY - rect.top) / rect.height) }
}

function GlidingCursor({
  x,
  y,
  size,
  children,
}: {
  x: number
  y: number
  size: { width: number; height: number }
  children: JSX.Element
}): JSX.Element {
  const glide = useMotionToken(springGlide)
  return (
    <motion.span
      className="pointer-events-none absolute top-0 left-0"
      initial={false}
      animate={{ x: x * size.width, y: y * size.height }}
      transition={glide}
    >
      {children}
    </motion.span>
  )
}

const PeerPointer = memo(function PeerPointer({
  state,
  size,
  focused,
  agentThinking,
}: {
  state: RoomPeerState & { cursor: NonNullable<RoomPeerState['cursor']> }
  size: { width: number; height: number }
  focused: boolean
  agentThinking: boolean
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const agent = isAgentPeer(state)
  const rested = useRestedFor(state.movedAt, agent ? AGENT_REST_MS : CURSOR_IDLE_MS)
  return (
    <GlidingCursor x={state.cursor.x} y={state.cursor.y} size={size}>
      {agent ? (
        <AgentCursor state={state} idle={rested && !agentThinking && !state.activity} />
      ) : (
        <LiveCursor
          color={identityInk(state.peer.userId)}
          label={state.peer.name}
          tag={focused}
          chat={focused ? state.chat : null}
          idle={!state.chat && rested}
          busy={
            state.tool === 'region' ? (
              <SquareDashed className="size-3" aria-label={t('review.peerRegion')} />
            ) : state.tool === 'point' ? (
              <Crosshair className="size-3" aria-label={t('review.peerPoint')} />
            ) : undefined
          }
        />
      )}
    </GlidingCursor>
  )
})

const tagWidth = (name: string): number => name.length * 6 + 14

export function draftTagPlace(
  draft: { x: number; y: number; w: number },
  name: string,
  page: { width: number; height: number }
): 'above' | 'inside' | 'beside-right' | 'beside-left' {
  if (page.width > 0 && draft.w * page.width < tagWidth(name)) {
    return (draft.x + draft.w) * page.width + 4 + tagWidth(name) <= page.width ? 'beside-right' : 'beside-left'
  }
  return tagFitsAbove(draft.y, page.height) ? 'above' : 'inside'
}

const DRAFT_TAG_CLASSES: Record<ReturnType<typeof draftTagPlace>, string> = {
  above: 'right-0 -top-px -translate-y-full rounded-t-[3px]',
  inside: 'right-0 top-0 rounded-bl-[3px]',
  'beside-right': 'left-full top-0 ml-1 rounded-[3px]',
  'beside-left': 'right-full top-0 mr-1 rounded-[3px]',
}

const selectionsKey = (selections: Map<string, RoomPeerState[]>): string =>
  [...selections].map(([id, states]) => `${id}:${states.map((state) => state.peer.peerId).join(',')}`).join('|')

function usePeerSelections(room: Pick<DocumentRoom, 'peers'>, selfUserId: string | null): Map<string, RoomPeerState[]> {
  const select = useCallback((peers: readonly RoomPeerState[]) => peerSelections(peers, selfUserId), [selfUserId])
  return useRoomSelector(room, select, (a, b) => selectionsKey(a) === selectionsKey(b))
}

const PageCompany = memo(function PageCompany({
  room,
  page,
  focused,
  size,
  marks,
  selfUserId,
  agentThinking,
}: {
  room: Pick<DocumentRoom, 'peers'>
  page: number
  focused: boolean
  size: { width: number; height: number }
  marks: readonly AnnotationView[]
  selfUserId: string | null
  agentThinking: boolean
}): JSX.Element {
  const here = usePeersOnPage(room, page)
  const selections = usePeerSelections(room, selfUserId)
  const pointers = here.filter((state): state is RoomPeerState & { cursor: NonNullable<RoomPeerState['cursor']> } =>
    Boolean(state.cursor)
  )
  const now = (state: RoomPeerState): RoomPeerState =>
    pointers.find((pointer) => pointer.peer.peerId === state.peer.peerId) ?? { ...state, cursor: null }
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30" data-testid={`review-company-${page}`}>
      {marks.map((annotation) => {
        const selectors = selections.get(annotation.id)
        if (!selectors) return null
        return (
          <PeerSelection
            key={annotation.id}
            annotation={annotation}
            selectors={selectors}
            tagged={focused ? selectionTagged(selectors.map(now), annotation, size) : []}
            pageHeight={size.height}
          />
        )
      })}

      {/* The boxes the others are drawing right now, in their colour, with whose they are. */}
      {pointers.map((state) =>
        state.draft && !isAgentPeer(state) ? (
          <span
            key={`draft-${state.peer.peerId}`}
            data-testid="review-peer-draft"
            className="absolute rounded-[2px] border-[1.5px] border-dashed"
            style={{
              ...box(state.draft.x, state.draft.y, state.draft.w, state.draft.h),
              borderColor: identityInk(state.peer.userId),
              backgroundColor: `color-mix(in oklch, ${identityInk(state.peer.userId)} 6%, transparent)`,
            }}
          >
            {focused && (
              <span
                data-testid="review-peer-draft-tag"
                data-place={draftTagPlace(state.draft, firstName(state.peer.name), size)}
                className={cn(
                  'absolute px-1.5 py-px text-[10px] leading-4 font-medium whitespace-nowrap text-background shadow-sm',
                  DRAFT_TAG_CLASSES[draftTagPlace(state.draft, firstName(state.peer.name), size)]
                )}
                style={{ backgroundColor: identityInk(state.peer.userId) }}
              >
                {firstName(state.peer.name)}
              </span>
            )}
          </span>
        ) : null
      )}

      {size.width > 0 &&
        pointers.map((state) => (
          <PeerPointer key={state.peer.peerId} state={state} size={size} focused={focused} agentThinking={agentThinking} />
        ))}
    </div>
  )
})

const PageMarks = memo(function PageMarks({
  marks,
  ghost = false,
  unread,
  focused,
  selectedId,
  hoveredId,
  selections,
  onPin,
  onHover,
}: {
  marks: readonly AnnotationView[]
  ghost?: boolean
  unread: ReadonlySet<string>
  focused: boolean
  selectedId: string | null
  hoveredId: string | null
  selections: Map<string, RoomPeerState[]>
  onPin: (annotationId: string, byKeyboard: boolean) => void
  onHover: (annotationId: string | null) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const byline = useAgentByline()
  return (
    <>
      {marks.map((annotation) => {
        const active = annotation.id === selectedId || annotation.id === hoveredId
        const ink = markInk(annotation)
        const proposed = annotation.status === 'proposed'
        const agentLine =
          annotation.authorKind === 'piloti' ? byline(annotation.createdByName, { proposal: proposed }) : undefined
        const done = !isLive(annotation)
        const openBy = selections.get(annotation.id)
        return (
          <div key={annotation.id} className={cn('contents', active && '[&>*]:z-20')}>
            {annotation.shape === 'region' && annotation.w && annotation.h && (
              <span
                data-testid="review-region"
                aria-hidden
                className={cn(
                  'absolute rounded-[2px] border-[1.5px] mix-blend-multiply transition-[background-color,opacity] duration-quick ease-out motion-reduce:transition-none',
                  proposed && 'border-dashed',
                  done && 'opacity-40',
                  ghost && 'border-dotted opacity-60'
                )}
                style={{
                  ...box(annotation.x, annotation.y, annotation.w, annotation.h),
                  borderColor: ink,
                  backgroundColor: active ? `color-mix(in oklch, ${ink} 9%, transparent)` : 'transparent',
                }}
              />
            )}
            <span
              className={cn('pointer-events-auto absolute z-10', COMMENT_PIN_ON_POINT)}
              style={at(annotation.x, annotation.y)}
            >
              <CommentPin
                data-testid={ghost ? 'review-ghost-pin' : 'review-pin'}
                className="touch-target"
                number={annotation.number}
                color={ink}
                proposed={proposed}
                done={done}
                ghost={ghost}
                unread={unread.has(annotation.id) && annotation.id !== selectedId}
                active={annotation.id === selectedId}
                aria-label={pinLabel(t, annotation, agentLine, openBy, {
                  ghost,
                  unread: unread.has(annotation.id) && annotation.id !== selectedId,
                })}
                aria-haspopup="dialog"
                aria-expanded={focused ? annotation.id === selectedId : undefined}
                title={agentLine}
                onPointerEnter={() => onHover(annotation.id)}
                onPointerLeave={() => onHover(null)}
                data-peer-selected={openBy ? true : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  onPin(annotation.id, event.detail === 0)
                }}
              />
            </span>
          </div>
        )
      })}
    </>
  )
})

type Translate = ReturnType<typeof useTranslations>

export function pinLabel(
  t: Translate,
  annotation: Pick<AnnotationView, 'number' | 'kind' | 'status' | 'revisionNumber'>,
  agentLine: string | undefined,
  openBy: readonly RoomPeerState[] | undefined,
  { ghost = false, unread = false }: { ghost?: boolean; unread?: boolean } = {}
): string {
  const state =
    annotation.status === 'proposed'
      ? t('review.pinState.proposed')
      : annotation.status === 'resolved'
        ? t('review.pinState.resolved')
        : annotation.status === 'dismissed'
          ? t('review.pinState.dismissed')
          : null
  const earlier = !ghost
    ? null
    : annotation.revisionNumber
      ? t('review.pinState.ghost', { number: annotation.revisionNumber })
      : t('review.pinState.ghostUnnumbered')
  return [
    t('review.pinLabel', { number: annotation.number, kind: t(`annotations.kinds.${annotation.kind}`) }),
    earlier,
    state,
    unread ? t('review.pinState.unread') : null,
    agentLine,
    openBy && openBy.length > 0
      ? t('review.pinOpenBy', { names: openBy.map((other) => other.peer.name).join(', ') })
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

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

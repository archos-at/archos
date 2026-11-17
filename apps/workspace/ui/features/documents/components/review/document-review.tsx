'use client'

import { useCallback, useEffect, useRef, useState, type JSX, type RefObject } from 'react'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Link2,
  MessageSquarePlus,
  MessagesSquare,
  MousePointer2,
  RotateCcw,
  Sparkles,
  Speech,
  SquareDashed,
  X,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PageDialog, PageDialogContent } from '@/components/ui/page-dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Button } from '@/components/ui/button'
import { PersonAvatar } from '@/components/ui/avatar-stack'
import { identityInk } from '@/components/ui/avatar-identity'
import { FloatingNote, FloatingToolbar, ToolbarIconButton } from '@/components/ui/floating-toolbar'
import { Kbd } from '@/components/ui/kbd'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { ShimmerText } from '@/components/ui/shimmer-text'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PdfDocumentView } from '@/features/knowledge/components/pdf-document-view'
import { liveLine } from '@/features/chat/lib/turn-events'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { filesCopy } from '@/i18n/namespaces/files'
import { presenceCopy } from '@/i18n/namespaces/presence'
import { isGhostMark, type AnnotationView } from '@/lib/annotations/types'
import { documentFileUrl } from '@/lib/documents/urls'
import { cn } from '@/lib/utils'
import { stepsOf, type CanvasAsk } from '../../hooks/use-canvas-ask'
import { DECISION_UNDO_MS, type DocumentReview as ReviewState, type ReviewTool } from '../../hooks/use-document-review'
import { sameValue } from '@/lib/utils/same-value'
import {
  useRoomPeers,
  useRoomSelector,
  type DocumentRoom,
  type RoomPeerState,
} from '../../hooks/use-document-room'
import { CursorChat } from './cursor-chat'
import { keepTrigger, restoreFocus } from './focus-return'
import { AgentAnswerCard } from './agent-answer-card'
import { isAgentPeer, ReviewPageLayer } from './review-page-layer'
import { ReviewPanel, type OpenMark } from './review-panel'
import { useReviewList } from './review-list'
import { ReviewAnnouncer } from './review-announcer'
import { ReviewExportMenu } from './review-export-menu'
import type { ProtocolFilingTarget } from '../../lib/protocol-filing'
import { useCheckFixed } from './check-fixed'
import { ReviewToaster, reviewToast } from './review-toaster'
import { hasLiveMarks, openMarksLabel, openMarksShortLabel } from '../open-marks-chip'
import { clearReviewParams, setReviewParams } from '../../lib/open-review'
import { covers, ReviewStageContext, STAGE_FOOT, STAGE_HEAD, type StageBounds } from './review-stage'
import { DraftCard, ThreadCard, type CardPlacement } from './thread-card'
import { PRODUCT_NAME } from '@/lib/brand'
import { isAgentKind } from '@/lib/agent-kind'

type PaletteTool = ReviewTool | 'chat'

const TOOLS: Array<{ tool: PaletteTool; key: string; icon: LucideIcon }> = [
  { tool: 'select', key: 'V', icon: MousePointer2 },
  { tool: 'point', key: 'C', icon: MessageSquarePlus },
  { tool: 'region', key: 'R', icon: SquareDashed },
  { tool: 'ask', key: 'P', icon: Sparkles },
  { tool: 'chat', key: '/', icon: Speech },
]

export const TOOLS_INTRO_KEY = 'review.toolsIntroSeen'

export function toolsIntroSeen(): boolean {
  try {
    return window.localStorage.getItem(TOOLS_INTRO_KEY) === '1'
  } catch {
    return true
  }
}

function rememberToolsIntro(): void {
  try {
    window.localStorage.setItem(TOOLS_INTRO_KEY, '1')
  } catch {
    // A private window: the intro shows again next time, which is harmless.
  }
}

const DOCKED_CARDS = '(max-width: 639px), (pointer: coarse) and (max-height: 500px)'

export function walkPosition(
  annotations: readonly Pick<AnnotationView, 'id' | 'status' | 'onCurrentRevision'>[],
  id: string | null
): { index: number; total: number } | null {
  const walk = annotations.filter((annotation) => annotation.status === 'proposed' && annotation.onCurrentRevision)
  const index = walk.findIndex((annotation) => annotation.id === id)
  return index === -1 ? null : { index: index + 1, total: walk.length }
}

function ReviewTools({
  review,
  chatOpen,
  onChat,
  variant,
  onFold,
  onAim,
}: {
  review: ReviewState
  chatOpen: boolean
  onChat: () => void
  variant: 'icons' | 'intro' | 'touch'
  onFold?: () => void
  onAim?: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const offered = TOOLS.filter(({ tool }) => tool === 'chat' || toolOffered(tool, review))
  return (
    <div role="group" aria-label={t('review.toolsLabel')} data-testid="review-tools" data-variant={variant} className="flex items-center gap-0.5">
      {offered.map(({ tool, key, icon: Icon }) => {
        const pressed = tool === 'chat' ? chatOpen : review.tool === tool
        const name = tool === 'chat' ? t('review.chatOpen') : t(`review.tools.${tool}`)
        const button = (
          <ToolbarIconButton
            data-testid={`review-tool-${tool}`}
            aria-pressed={pressed}
            aria-keyshortcuts={key}
            aria-label={name}
            onClick={(event) => {
              if (tool === 'chat') return onChat()
              review.setTool(pressed ? 'select' : tool)
              if (!pressed && tool !== 'select' && event.detail === 0) onAim?.()
            }}
            className={cn(
              'aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:text-background',
              variant === 'intro' && 'w-auto gap-1.5 px-2 text-xs font-medium @max-5xl:w-7 @max-5xl:px-0',
              variant === 'touch' && 'h-12 w-14 flex-col gap-0.5 pointer-coarse:size-auto pointer-coarse:h-12 pointer-coarse:w-14'
            )}
          >
            <Icon aria-hidden />
            {variant === 'intro' && (
              <>
                {/* The short name: the pill also carries the viewer's own controls. */}
                <span className="@max-5xl:sr-only">{t(`review.toolsShort.${tool}`)}</span>
                <Kbd className="h-4 min-w-4 px-1 text-[10px] @max-5xl:hidden">{key}</Kbd>
              </>
            )}
            {variant === 'touch' && <span className="text-[10px] leading-3 font-medium">{t(`review.toolsShort.${tool}`)}</span>}
          </ToolbarIconButton>
        )
        if (variant === 'touch') return <span key={tool} className="contents">{button}</span>
        return (
          <Tooltip key={tool}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="top">
              {name} <Kbd className="ml-1">{key}</Kbd>
            </TooltipContent>
          </Tooltip>
        )
      })}
      {variant === 'intro' && onFold && (
        <ToolbarIconButton
          aria-label={t('review.toolsIntroFold')}
          title={t('review.toolsIntroFold')}
          data-testid="review-tools-fold"
          className="@max-5xl:hidden"
          onClick={onFold}
        >
          <X aria-hidden />
        </ToolbarIconButton>
      )}
    </div>
  )
}

const toolOffered = (tool: ReviewTool, review: ReviewState): boolean =>
  tool === 'select' || (tool === 'ask' ? review.piloti.available : review.canAnnotate)

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export function people(peers: readonly RoomPeerState[]): RoomPeerState[] {
  const byUser = new Map<string, RoomPeerState>()
  for (const state of peers) {
    if (!isAgentPeer(state) && !byUser.has(state.peer.userId)) byUser.set(state.peer.userId, state)
  }
  return [...byUser.values()]
}

export interface RoomCompany {
  people: Array<{ peerId: string; userId: string; name: string; page: number | null }>
  piloti: { forName: string | null; working: boolean; label: string | null } | null
}

export function roomCompanyOf(peers: readonly RoomPeerState[]): RoomCompany {
  const agent = peers.find(isAgentPeer) ?? null
  return {
    people: people(peers).map((state) => ({
      peerId: state.peer.peerId,
      userId: state.peer.userId,
      name: state.peer.name,
      page: pageOf(state),
    })),
    piloti: agent
      ? { forName: agent.peer.forName ?? null, working: Boolean(agent.activity), label: agent.activity?.label ?? null }
      : null,
  }
}

export const useRoomCompany = (room: Pick<DocumentRoom, 'peers'>): RoomCompany =>
  useRoomSelector(room, roomCompanyOf, sameValue)

export function Presence({
  review,
  following = null,
  onFollow,
}: {
  review: ReviewState
  following?: string | null
  onFollow?: (peerId: string | null) => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const tPresence = useTranslations(presenceCopy)
  const { people: others, piloti: agent } = useRoomCompany(review.room)
  const forName = agent?.forName
  const onBehalf = forName ? tPresence('piloti.onBehalfOf', { name: forName }) : null
  if (others.length === 0 && !agent) return null
  if (!onFollow) {
    return (
      <span aria-hidden className="flex items-center -space-x-1" data-testid="review-presence">
        {agent && (
          <span className="ring-background rounded-full ring-2">
            <AgentGlyph size="md" working={agent.working} label={onBehalf ?? PRODUCT_NAME} />
          </span>
        )}
        {others.map((person) => (
          <PersonAvatar
            key={person.userId}
            size="sm"
            className="ring-background size-7 text-[10px] ring-2"
            person={{ userId: person.userId, name: person.name, profilePictureUrl: null }}
          />
        ))}
      </span>
    )
  }
  return (
    <div className="flex items-center -space-x-1" data-testid="review-presence">
      {agent && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span data-testid="review-presence-agent" className="ring-background rounded-full ring-2">
              <AgentGlyph size="md" working={agent.working} label={onBehalf ?? PRODUCT_NAME} />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {onBehalf ? (
              <>
                <span className="block">{onBehalf}</span>
                {agent.label && <span className="block">{agent.label}</span>}
              </>
            ) : (
              agent.label || t('review.agentWorking')
            )}
          </TooltipContent>
        </Tooltip>
      )}
      {others.map((person) => {
        const on = following === person.peerId
        return (
          <Tooltip key={person.userId}>
            <TooltipTrigger asChild>
              <button data-attr="review-peer"
                type="button"
                data-testid="review-peer"
                aria-pressed={on}
                aria-label={on ? t('review.unfollow', { name: person.name }) : t('review.follow', { name: person.name })}
                onClick={() => onFollow(on ? null : person.peerId)}
                className="relative rounded-full outline-none focus-visible:ring-2"
              >
                <PersonAvatar
                  size="sm"
                  className="ring-background size-7 text-[10px] ring-2"
                  person={{ userId: person.userId, name: person.name, profilePictureUrl: null }}
                />
                <span
                  aria-hidden
                  className={cn('absolute -inset-[3px] rounded-full border-2', on ? 'opacity-100' : 'opacity-0')}
                  style={{ borderColor: identityInk(person.userId) }}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <span className="block">
                {on ? t('review.unfollow', { name: person.name }) : t('review.follow', { name: person.name })}
              </span>
              {person.page && <span className="block">{t('review.onPage', { name: person.name, page: person.page })}</span>}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

const pageOf = (state: RoomPeerState): number | null => state.cursor?.page ?? state.viewport?.page ?? null

export type PeerSide = 'here' | 'above' | 'below'

export function peerSide(
  at: { page: number; y: number },
  viewPage: number,
  pageRect: { top: number; height: number } | null,
  view: { top: number; bottom: number } | null
): PeerSide {
  if (pageRect && view && pageRect.height > 0) {
    const y = pageRect.top + at.y * pageRect.height
    return y < view.top ? 'above' : y > view.bottom ? 'below' : 'here'
  }
  return at.page < viewPage ? 'above' : at.page > viewPage ? 'below' : 'here'
}

function useScrollTick(ref: RefObject<HTMLElement | null>): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    let frame: number | null = null
    const onScroll = () => {
      if (frame === null)
        frame = requestAnimationFrame(() => {
          frame = null
          setTick((tick) => tick + 1)
        })
    }
    node.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      node.removeEventListener('scroll', onScroll, { capture: true })
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [ref])
}

function Elsewhere({
  review,
  page,
  edge,
  canvas,
  onJump,
}: {
  review: ReviewState
  page: number
  edge: 'above' | 'below'
  canvas: RefObject<HTMLElement | null>
  onJump: (state: RoomPeerState) => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  useScrollTick(canvas)
  const row = useRef<HTMLDivElement | null>(null)
  const node = canvas.current
  const view = node?.getBoundingClientRect() ?? null
  const card = node?.querySelector<HTMLElement>('[data-review-card]')?.getBoundingClientRect() ?? null
  const lane = row.current?.getBoundingClientRect() ?? null
  const overCard = Boolean(card && lane && covers(card, lane))
  const peers = useRoomPeers(review.room)
  const here = people(peers).flatMap((state) => {
    const at = pageOf(state)
    if (at === null) return []
    const y = state.cursor?.page === at ? state.cursor.y : (state.viewport?.y ?? 0.5)
    const layer = node?.querySelector<HTMLElement>(`[data-testid="review-layer-${at}"]`)
    const side = peerSide({ page: at, y }, page, layer?.getBoundingClientRect() ?? null, view)
    return side === edge ? [{ state, at }] : []
  })
  if (here.length === 0) return null
  const Arrow = edge === 'above' ? ArrowUp : ArrowDown
  return (
    <div
      ref={row}
      className={cn(
        'pointer-events-none flex flex-wrap justify-center gap-1.5',
        edge === 'below' && 'absolute bottom-16 left-1/2 z-30 -translate-x-1/2 pointer-coarse:bottom-36',
        overCard && 'invisible'
      )}
      data-testid={`review-elsewhere-${edge}`}
      data-over-card={overCard || undefined}
    >
      {here.map(({ state, at }) => (
        <button data-attr="review-elsewhere"
          key={state.peer.userId}
          type="button"
          data-testid="review-elsewhere"
          aria-label={t('review.elsewhereJump', { name: state.peer.name, page: at })}
          title={t('review.elsewhereJump', { name: state.peer.name, page: at })}
          onClick={() => onJump(state)}
          className="pointer-events-auto inline-flex items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5 text-[11px] leading-4 font-medium text-background shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          style={{ backgroundColor: identityInk(state.peer.userId) }}
        >
          <Arrow className="size-3" aria-hidden />
          {t('review.elsewhere', { name: state.peer.name.split(/\s+/)[0] ?? state.peer.name, page: at })}
        </button>
      ))}
    </div>
  )
}

const documentReviewOf = (asks: readonly CanvasAsk[]): CanvasAsk | null =>
  asks.findLast((ask) => ask.region === null && !ask.replyInThread) ?? null

function AgentReview({ review, onWalk }: { review: ReviewState; onWalk: () => void }): JSX.Element {
  const t = useTranslations(filesCopy)
  const tChat = useTranslations(chatCopy)
  const { piloti: agent } = review
  const run = documentReviewOf(agent.asks)
  if (!run) {
    const button = (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 gap-1.5"
        data-testid="review-with-agent"
        disabled={agent.busy}
        onClick={() => agent.ask({ text: t('review.reviewSeed'), region: null, effort: 'medium' })}
      >
        <Sparkles className="size-3.5" aria-hidden />
        {/* On a phone the glyph carries it; the words stay for a screen reader. */}
        <span className="max-sm:sr-only">{t('review.reviewWithAgent')}</span>
      </Button>
    )
    if (!agent.busy) return button
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-control" data-testid="review-with-agent-busy">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('review.piloti.busyTooltip')}</TooltipContent>
      </Tooltip>
    )
  }
  const working = run.status === 'thinking'
  const checking = run.checkFixed !== null
  const found = run.status === 'answered' && !checking ? review.counts.proposed : 0
  const line = working
    ? (liveLine(stepsOf(run.view), tChat) ?? t(checking ? 'review.piloti.checkingFixed' : 'review.piloti.reviewing'))
    : run.status === 'failed'
      ? t('review.piloti.reviewFailed')
      : found > 0
        ? t('review.piloti.reviewFound', { count: found })
        : t(checking ? 'review.piloti.checkFixedDone' : 'review.piloti.reviewDone')
  return (
    <div
      role="status"
      data-testid="review-agent-status"
      className="border-border/70 bg-muted flex h-8 max-w-[30rem] items-center gap-2 rounded-full border pr-1 pl-1"
    >
      <AgentGlyph working={working} />
      {working ? (
        <ShimmerText className="min-w-0 flex-1 text-xs">{line}</ShimmerText>
      ) : (
        <span className="text-foreground min-w-0 flex-1 truncate text-xs font-medium">{line}</span>
      )}
      {found > 0 && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-6 shrink-0 rounded-full px-2.5 text-xs"
          data-testid="review-agent-walk"
          onClick={onWalk}
        >
          {t('review.walkProposals')}
        </Button>
      )}
      {agent.conversationHref && (
        <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-xs">
          <Link href={agent.conversationHref} data-testid="review-agent-conversation">
            {t('review.piloti.openConversation')}
          </Link>
        </Button>
      )}
      {run.status === 'failed' && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 rounded-full [&_svg]:size-3"
          aria-label={t('review.piloti.retry')}
          onClick={() => agent.retry(run.id)}
        >
          <RotateCcw aria-hidden />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 rounded-full [&_svg]:size-3"
        aria-label={working ? t('review.piloti.stop') : t('review.piloti.close')}
        title={working ? t('review.piloti.stop') : t('review.piloti.close')}
        data-testid="review-agent-dismiss"
        onClick={() => agent.dismiss(run.id)}
      >
        <X aria-hidden />
      </Button>
    </div>
  )
}

export function DocumentReviewMode({
  open,
  onOpenChange,
  review,
  documentName,
  revisionLabel,
  canPickAssignee,
  focusRequest,
  popoutHref = null,
  initialTool,
  onPage,
  protocolFiling = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  review: ReviewState
  documentName: string
  revisionLabel?: string | null
  canPickAssignee: boolean
  focusRequest?: { annotationId: string; key: number } | null
  popoutHref?: string | null
  initialTool?: ReviewTool
  onPage?: (page: number) => void
  protocolFiling?: ProtocolFilingTarget | null
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const [focus, setFocus] = useState<{ page: number; y: number; key: string; instant?: boolean } | null>(null)
  const [following, setFollowing] = useState<string | null>(null)
  const { annotations, select, setTool, tool, selectedId, draft, setDraft, room, piloti: agent } = review
  const [viewPage, setViewPage] = useState<number | null>(null)
  const viewAt = useRef<{ page: number; y: number } | null>(null)
  const { sendViewport } = room
  const onViewport = useCallback(
    (viewport: { page: number; y: number }) => {
      if (viewAt.current?.page !== viewport.page) onPage?.(viewport.page)
      viewAt.current = viewport
      setViewPage(viewport.page)
      sendViewport(viewport)
    },
    [sendViewport, onPage]
  )
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const touch = useMediaQuery('(pointer: coarse)')
  const foot = touch ? STAGE_FOOT.touch : STAGE_FOOT.pointer
  const stage = useCallback<StageBounds>(() => {
    const box = canvasRef.current?.getBoundingClientRect()
    return box ? { top: box.top + STAGE_HEAD, bottom: box.bottom - foot } : null
  }, [foot])
  const [chat, setChat] = useState<{ from: { x: number; y: number } | null } | null>(null)
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  const openChat = useCallback((atPointer: boolean) => setChat({ from: atPointer ? lastPointer.current : null }), [])
  const jumpTo = useCallback((state: RoomPeerState) => {
    const page = pageOf(state)
    if (page === null) return
    setFollowing(null)
    const y = state.viewport?.page === page ? state.viewport.y : (state.cursor?.y ?? 0)
    setFocus({ page, y, key: `jump:${state.peer.peerId}:${Date.now()}` })
  }, [])
  const openAsk = agent.asks.find((ask) => ask.id === agent.openId) ?? null
  const list = useReviewList(review)
  const { beside: listBeside, sheetOpen: listOpen, setSheetOpen: setListOpen } = list
  const docked = useMediaQuery(DOCKED_CARDS)

  const [intro, setIntro] = useState(false)
  useEffect(() => {
    if (open && !touch && !toolsIntroSeen()) setIntro(true)
  }, [open, touch])
  const foldIntro = useCallback(() => {
    setIntro(false)
    rememberToolsIntro()
  }, [])
  useEffect(() => {
    if (intro && (draft || openAsk)) foldIntro()
  }, [intro, draft, openAsk, foldIntro])

  const { watchMarksSetNews } = review
  useEffect(() => (open ? watchMarksSetNews() : undefined), [open, watchMarksSetNews])

  const armed = useRef(false)
  useEffect(() => {
    if (!open) {
      armed.current = false
      return
    }
    if (armed.current || !initialTool || !toolOffered(initialTool, review)) return
    armed.current = true
    setTool(initialTool)
  }, [open, initialTool, review, setTool])

  const bring = useCallback(
    (annotation: AnnotationView) => {
      setFollowing(null)
      setDraft(null)
      select(annotation.id)
      if (annotation.onCurrentRevision || isGhostMark(annotation, review.documentId)) {
        setFocus({ page: annotation.page, y: annotation.y + (annotation.h ?? 0) / 2, key: `${annotation.id}:${Date.now()}` })
      }
    },
    [select, setDraft, review.documentId]
  )

  const cardTrigger = useRef<HTMLElement | null>(null)
  const [cardFocusAsked, setCardFocusAsked] = useState(0)
  const cardFocusAnswered = useRef(0)
  const focusNextCard = useCallback(() => {
    cardTrigger.current = keepTrigger(cardTrigger.current)
    setCardFocusAsked((asked) => asked + 1)
  }, [])
  const cardInHand = openAsk?.id ?? (draft ? 'draft' : selectedId)
  useEffect(() => {
    if (cardFocusAsked !== cardFocusAnswered.current) {
      cardFocusAnswered.current = cardFocusAsked
      if (!cardInHand) return
      const frame = requestAnimationFrame(() => {
        const card = document.querySelector<HTMLElement>('[data-review-card]')
        if (card && !card.contains(document.activeElement)) card.focus({ preventScroll: true })
      })
      return () => cancelAnimationFrame(frame)
    }
    const trigger = cardTrigger.current
    if (cardInHand || !trigger) return
    cardTrigger.current = null
    const frame = requestAnimationFrame(() => restoreFocus(trigger))
    return () => cancelAnimationFrame(frame)
  }, [cardInHand, cardFocusAsked])

  const [aim, setAim] = useState<{ page: number; y: number; key: number } | null>(null)
  const aimTrigger = useRef<HTMLElement | null>(null)
  const startAim = useCallback(() => {
    aimTrigger.current = keepTrigger(aimTrigger.current)
    const at = viewAt.current
    setAim({ page: at?.page ?? viewPage ?? 1, y: at?.y ?? 0.5, key: Date.now() })
  }, [viewPage])
  useEffect(() => {
    if (tool !== 'select' || !aim) return
    setAim(null)
    const trigger = aimTrigger.current
    aimTrigger.current = null
    if (!trigger) return
    const frame = requestAnimationFrame(() => restoreFocus(trigger))
    return () => cancelAnimationFrame(frame)
  }, [tool, aim])

  const [walking, setWalking] = useState<string | null>(null)
  const walkProposals = useCallback(() => {
    const next = review.step(1, 'proposed')
    setWalking(next?.id ?? null)
    if (next) bring(next)
  }, [review, bring])
  useEffect(() => {
    if (!walking) return
    if (selectedId !== walking) {
      setWalking(null)
      return
    }
    const current = annotations.find((annotation) => annotation.id === walking)
    if (current?.status === 'proposed') return
    const next = review.step(1, 'proposed')
    setWalking(next?.id ?? null)
    if (next) bring(next)
  }, [walking, selectedId, annotations, review, bring])
  const walk = walking ? walkPosition(annotations, walking) : null
  const openFromList = useCallback<OpenMark>(
    (annotation, byKeyboard) => {
      if (byKeyboard) focusNextCard()
      bring(annotation)
    },
    [bring, focusNextCard]
  )

  const handled = useRef<number | null>(null)
  useEffect(() => {
    if (!open || !focusRequest || handled.current === focusRequest.key) return
    const target = annotations.find((annotation) => annotation.id === focusRequest.annotationId)
    if (!target) return
    handled.current = focusRequest.key
    bring(target)
  }, [open, focusRequest, annotations, bring])

  const followed = useRoomSelector(
    room,
    useCallback(
      (peers: readonly RoomPeerState[]) => {
        const state = following ? peers.find((peer) => peer.peer.peerId === following) : undefined
        return state
          ? { peerId: state.peer.peerId, userId: state.peer.userId, name: state.peer.name, viewport: state.viewport }
          : null
      },
      [following]
    ),
    sameValue
  )
  useEffect(() => {
    if (!following) return
    if (!followed) {
      setFollowing(null)
      return
    }
    if (!followed.viewport) return
    setFocus({
      page: followed.viewport.page,
      y: followed.viewport.y,
      key: `follow:${followed.viewport.page}:${followed.viewport.y.toFixed(3)}`,
      instant: true,
    })
  }, [following, followed])

  const { notice, dismissNotice } = review
  useEffect(() => {
    if (notice !== 'conflict') return
    toast.info(t('review.conflict'), reviewToast())
    dismissNotice()
  }, [notice, dismissNotice, t])

  const close = useCallback(() => {
    setFollowing(null)
    setDraft(null)
    setTool('select')
    onOpenChange(false)
  }, [onOpenChange, setDraft, setTool])

  const earlier = annotations.find((annotation) => annotation.id === selectedId && !annotation.onCurrentRevision) ?? null
  const selected = annotations.find((annotation) => annotation.id === selectedId) ?? null
  const dockedAsk = openAsk && openAsk.region && !openAsk.replyInThread ? openAsk : null
  const dockOpen = docked && Boolean(dockedAsk || draft || selected)
  const closeCard = useCallback(() => {
    if (dockedAsk) {
      if (dockedAsk.status === 'thinking') agent.open(null)
      else agent.dismiss(dockedAsk.id)
    } else if (draft) setDraft(null)
    else select(null)
  }, [dockedAsk, agent, draft, setDraft, select])

  const stepBack = (event: KeyboardEvent) => {
    event.preventDefault()
    if (typing(event.target) && !draft && !openAsk) return
    if (openAsk) agent.open(null)
    else if (draft) setDraft(null)
    else if (following) setFollowing(null)
    else if (tool !== 'select') setTool('select')
    else if (selectedId) select(null)
    else close()
  }

  const decideByKey = (current: AnnotationView, status: 'open' | 'resolved' | 'dismissed') => {
    const held = review.decide(current, status, () => toast.error(t('review.actionFailed'), reviewToast()))
    if (!held) return
    const said = status === 'open' ? 'accepted' : status
    toast(
      t(`review.decided.${said}`, { number: current.number }),
      reviewToast({
        id: `review-decided-${current.id}`,
        duration: DECISION_UNDO_MS,
        action: { label: t('review.undo'), onClick: () => review.undoDecision(current.id) },
      }),
    )
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    if (listOpen || dockOpen) return
    if (event.key === 'Escape' || typing(event.target)) return
    const key = event.key.toLowerCase()
    if (key === '/') openChat(true)
    else if (key === 'v') setTool('select')
    else if ((key === 'c' || key === 'r') && review.canAnnotate) {
      setTool(key === 'c' ? 'point' : 'region')
      startAim()
    } else if (key === 'p' && agent.available) {
      setTool('ask')
      startAim()
    } else if (key === 'j' && walk) {
      focusNextCard()
      walkProposals()
    } else if (key === 'j' || key === 'k') {
      const next = review.step(key === 'j' ? 1 : -1)
      if (next) {
        focusNextCard()
        bring(next)
      }
    } else if (key === 'e' && selectedId) {
      const current = annotations.find((annotation) => annotation.id === selectedId)
      if (!current?.canEdit) return
      if (current.status === 'proposed') decideByKey(current, 'open')
      else if (current.status === 'open') decideByKey(current, 'resolved')
    } else if ((key === 'backspace' || key === 'delete') && selectedId) {
      const current = annotations.find((annotation) => annotation.id === selectedId)
      if (!current?.canEdit || current.status !== 'proposed') return
      decideByKey(current, 'dismissed')
    } else return
    event.preventDefault()
  }
  const onKeyRef = useRef(onKey)
  useEffect(() => {
    onKeyRef.current = onKey
  })
  useEffect(() => {
    if (!open) return
    const listener = (event: KeyboardEvent) => onKeyRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [open])

  const copyText = useCallback(
    (text: string) => {
      if (!navigator.clipboard) {
        toast.error(t('review.linkCopyFailed'), reviewToast())
        return
      }
      void navigator.clipboard
        .writeText(text)
        .then(() => toast.success(t('review.linkCopied'), reviewToast()))
        .catch(() => toast.error(t('review.linkCopyFailed'), reviewToast()))
    },
    [t]
  )
  const copyLink = useCallback(
    (annotation: AnnotationView) => {
      const url = new URL(popoutHref ?? window.location.href, window.location.href)
      clearReviewParams(url.searchParams)
      setReviewParams(url.searchParams, { documentId: annotation.documentId, annotationId: annotation.id }, { withDocument: true })
      copyText(url.toString())
    },
    [copyText, popoutHref]
  )
  const popout = useCallback(() => {
    if (popoutHref) window.open(popoutHref, '_blank', 'popup,width=1440,height=900')
  }, [popoutHref])

  const followedState = followed

  const threadCard = (placement: CardPlacement) => {
    if (draft) return <DraftCard review={review} draft={draft} placement={placement} canPickAssignee={canPickAssignee} />
    if (!selected) return null
    return (
      <ThreadCard
        key={selected.id}
        review={review}
        annotation={selected}
        placement={placement}
        canPickAssignee={canPickAssignee}
        onCopyLink={copyLink}
        walk={walk && walking === selected.id ? { ...walk, onNext: walkProposals } : null}
      />
    )
  }

  const toolHint =
    tool !== 'select' && !draft && !openAsk
      ? aim
        ? t(`review.aim.hint.${tool}`)
        : t(`review.${touch ? 'toolHintTouch' : 'toolHint'}.${tool}`)
      : null

  const toolsPalette = (variant: 'icons' | 'intro' | 'touch') => (
    <ReviewTools
      review={review}
      chatOpen={chat !== null}
      onChat={() => openChat(false)}
      variant={variant}
      onFold={foldIntro}
      onAim={startAim}
    />
  )
  const exportMenu = annotations.length > 0 && (
    <ReviewExportMenu
      documentId={review.documentId}
      hasRevisions={annotations.some((annotation) => !annotation.onCurrentRevision)}
      hasProposals={annotations.some((annotation) => isAgentKind(annotation.authorKind) && !annotation.acceptedBy)}
      filing={protocolFiling && review.canAnnotate ? { target: protocolFiling, documentName } : null}
    />
  )
  const checkFixed = useCheckFixed(review, { documentName, revisionLabel: revisionLabel ?? null })

  return (
    <PageDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <PageDialogContent
        showCloseButton={false}
        onEscapeKeyDown={stepBack}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="bg-background inset-0 top-[var(--page-inset-top,0px)] left-[var(--page-inset-start,0px)] flex h-[calc(100dvh-var(--page-inset-top,0px))] max-h-none w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        data-testid="document-review"
      >
        <header className="flex min-h-13 shrink-0 items-center gap-3 border-b px-3 pt-[env(safe-area-inset-top)] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] max-sm:flex-wrap max-sm:gap-x-2 max-sm:gap-y-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 pointer-coarse:size-11"
            aria-label={t('review.close')}
            title={`${t('review.close')} (Esc)`}
            onClick={close}
          >
            <X className="size-4" aria-hidden />
          </Button>
          {/* On a phone the name has a row of its own, under the close and the
              faces: beside them it kept ~40px, „G…_Index-C.pdf". Cut in the
              middle where even the row is short: the index at its end is what
              says which Fassung is under review. The line under it wraps there
              rather than lose the count. */}
          <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full max-sm:pb-2">
            <DialogTitle className="text-foreground flex text-sm font-medium">
              <MiddleTruncate text={documentName} tail={12} />
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs sm:truncate">
              {[
                revisionLabel,
                review.revision?.replacedBy
                  ? t('review.replacedBy', { name: review.revision.replacedBy.filename })
                  : review.revision?.replaces[0]
                    ? t('review.replaces', { name: review.revision.replaces[0].filename })
                    : null,
                hasLiveMarks(review.counts) ? openMarksShortLabel(t, review.counts) : t('review.nothingOpen'),
              ]
                .filter(Boolean)
                .join(' · ')}
            </DialogDescription>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3 max-sm:gap-2">
            {room.status === 'offline' && (
              <span
                className="text-muted-foreground text-[11px] font-medium"
                data-testid="review-offline"
                title={t('review.offlineHint')}
                role="status"
              >
                {t('review.offline')}
              </span>
            )}
            <Presence review={review} following={following} onFollow={setFollowing} />
            {popoutHref && (
              <span className="flex items-center max-sm:hidden">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t('review.popout')}
                  title={t('review.popout')}
                  data-testid="review-popout"
                  onClick={popout}
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t('review.copyReviewLink')}
                  title={t('review.copyReviewLink')}
                  data-testid="review-copy-link"
                  onClick={() => copyText(new URL(popoutHref, window.location.href).toString())}
                >
                  <Link2 className="size-3.5" aria-hidden />
                </Button>
              </span>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 gap-1.5 pointer-coarse:h-11"
              aria-haspopup={listBeside ? undefined : 'dialog'}
              aria-expanded={list.expanded}
              aria-label={t('review.listOpen', {
                marks: hasLiveMarks(review.counts) ? openMarksLabel(t, locale, review.counts) : t('review.nothingOpen'),
              })}
              data-testid="review-list-open"
              onClick={list.toggle}
            >
              <MessagesSquare className="size-3.5" aria-hidden />
              {/* The open marks, as „offen“ counts them everywhere: the agent's proposals are not the office's yet. */}
              <span className="font-mono tabular-nums">{review.counts.open}</span>
            </Button>
            {listBeside && exportMenu}
            {agent.available && review.canAnnotate && <AgentReview review={review} onWalk={walkProposals} />}
          </div>
        </header>

        <ReviewStageContext.Provider value={stage}>
          <div className="flex min-h-0 flex-1">
            <div
              ref={canvasRef}
              className="relative min-w-0 flex-1"
              data-testid="review-canvas"
              onWheelCapture={() => following && setFollowing(null)}
              onPointerDownCapture={() => following && setFollowing(null)}
              onPointerMove={(event) => {
                lastPointer.current = { x: event.clientX, y: event.clientY }
              }}
            >
              {/* What sits at the top of the canvas, one under the other: whom the
                  view follows, who is out of view above, what the tool in hand does. */}
              <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex flex-col items-center gap-1.5">
                {followedState && (
                  <span
                    className="rounded-full px-3 py-1 text-xs font-medium text-background shadow-md"
                    style={{ backgroundColor: identityInk(followedState.userId) }}
                    role="status"
                  >
                    {t('review.following', { name: followedState.name })}
                  </span>
                )}
                <Elsewhere review={review} page={viewPage ?? 1} edge="above" canvas={canvasRef} onJump={jumpTo} />
                {toolHint && (
                  <FloatingNote role={aim ? undefined : 'status'} aria-hidden={aim ? true : undefined} data-testid="review-tool-hint">
                    {toolHint}
                  </FloatingNote>
                )}
              </div>
              <Elsewhere review={review} page={viewPage ?? 1} edge="below" canvas={canvasRef} onJump={jumpTo} />
              {earlier && !openAsk && !draft && !docked && (
                <div className="absolute top-4 left-1/2 z-40 -translate-x-1/2" data-testid="review-earlier-thread">
                  {threadCard('detached')}
                </div>
              )}
              {chat && (
                <CursorChat
                  userId={room.self?.userId ?? null}
                  from={chat.from}
                  bounds={() => canvasRef.current?.getBoundingClientRect() ?? null}
                  foot={foot}
                  onChat={room.sendChat}
                  onClose={() => setChat(null)}
                />
              )}
              {followedState && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-30 border-[3px]"
                  style={{ borderColor: identityInk(followedState.userId) }}
                />
              )}
              {touch && (
                <FloatingToolbar className="pointer-events-auto absolute bottom-[4.75rem] left-1/2 z-30 -translate-x-1/2">
                  {toolsPalette('touch')}
                </FloatingToolbar>
              )}
              <PdfDocumentView
                src={documentFileUrl(review.documentId)}
                title={documentName}
                focus={focus}
                onViewport={onViewport}
                toolbarLead={touch ? undefined : toolsPalette(intro ? 'intro' : 'icons')}
                pageOverlay={(page) => (
                  <ReviewPageLayer
                    page={page}
                    review={review}
                    focused
                    onPinByKeyboard={focusNextCard}
                    aim={aim && aim.page === page ? aim : null}
                    renderAsk={
                      docked ? undefined : (ask, { placement }) => <AgentAnswerCard key={ask.id} review={review} ask={ask} placement={placement} />
                    }
                    renderThread={
                      docked
                        ? undefined
                        : ({ placement }) => (draft && draft.page !== page ? null : threadCard(placement))
                    }
                  />
                )}
                className="size-full"
              />
              <ReviewToaster foot={foot} />
            </div>
            <div hidden={!list.columnOpen} className="flex shrink-0" data-testid="review-list-column">
              <ReviewPanel review={review} onOpen={openFromList} onWalkProposals={walkProposals} onCheckFixed={checkFixed} />
            </div>
          </div>
        </ReviewStageContext.Provider>
        {docked && (
          <Sheet open={dockOpen} modal={false} onOpenChange={(next) => !next && closeCard()}>
            <SheetContent
              side="bottom"
              closeLabel={t('review.closeThread')}
              data-testid="review-card-sheet"
              onInteractOutside={(event) => event.preventDefault()}
              className="max-h-[75dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
            >
              <SheetTitle className="sr-only">{documentName}</SheetTitle>
              <SheetDescription className="sr-only">{t('annotations.section')}</SheetDescription>
              {dockedAsk ? (
                <AgentAnswerCard key={dockedAsk.id} review={review} ask={dockedAsk} placement="docked" />
              ) : (
                threadCard('docked')
              )}
            </SheetContent>
          </Sheet>
        )}
        {!listBeside && (
          <Sheet open={listOpen} onOpenChange={setListOpen}>
            <SheetContent
              side="bottom"
              closeLabel={t('review.close')}
              data-testid="review-list-sheet"
              className="flex h-[70dvh] flex-col gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)] sm:mx-auto sm:max-w-xl"
            >
              <SheetHeader className="flex-row items-center gap-2 px-4 pt-4 pr-14 pb-0">
                <SheetTitle className="text-base">{t('annotations.section')}</SheetTitle>
                <SheetDescription className="sr-only">{documentName}</SheetDescription>
                {exportMenu && <div className="ml-auto">{exportMenu}</div>}
              </SheetHeader>
              <ReviewPanel
                review={review}
                presentation="sheet"
                onOpen={(annotation, byKeyboard) => {
                  setListOpen(false)
                  openFromList(annotation, byKeyboard)
                }}
                onWalkProposals={() => {
                  setListOpen(false)
                  walkProposals()
                }}
                onCheckFixed={checkFixed}
              />
            </SheetContent>
          </Sheet>
        )}
        <ReviewAnnouncer review={review} />
      </PageDialogContent>
    </PageDialog>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/use-media-query'
import { identityInk } from '@/components/ui/avatar-identity'
import { FloatingNote, FloatingToolbar } from '@/components/ui/floating-toolbar'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { PeerTag } from '@/components/ui/live-cursor'
import { PdfDocumentView } from '@/features/knowledge/components/pdf-document-view'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { isGhostMark, type AnnotationView } from '@/lib/annotations/types'
import { documentFileUrl } from '@/lib/documents/urls'
import { cn } from '@/lib/utils'
import { DECISION_UNDO_MS, type DocumentReview as ReviewState, type ReviewTool } from '../../hooks/use-document-review'
import { sameValue } from '@/lib/utils/same-value'
import {
  useRoomPeers,
  useRoomSelector,
  type RoomPeerState,
} from '../../hooks/use-document-room'
import type { ReviewStageSlots } from '../../preview-actions'
import { CursorChat } from './cursor-chat'
import { OWN_CURSOR_ZONE, OwnCursor } from './own-cursor'
import { keepTrigger, restoreFocus } from './focus-return'
import { AgentAnswerCard } from './agent-answer-card'
import { ReviewPageLayer } from './review-page-layer'
import { pageOf, people } from './presence'
import { ReviewHeader } from './review-header'
import { ReviewPageMenu } from './review-page-menu'
import { ReviewPanel, type OpenMark } from './review-panel'
import { ReviewAnnouncer } from './review-announcer'
import { ReviewExportMenu } from './review-export-menu'
import type { ProtocolFilingTarget } from '../../lib/protocol-filing'
import { useCheckFixed } from './check-fixed'
import { ReviewToaster, reviewToast } from './review-toaster'
import { clearReviewParams, setReviewParams } from '../../lib/open-review'
import { covers, ReviewStageContext, STAGE_FOOT, STAGE_HEAD, type StageBounds } from './review-stage'
import { DraftCard, ThreadCard, type CardPlacement } from './thread-card'
import { rememberToolsIntro, ReviewTools, toolOffered, toolsIntroSeen } from './review-tools'

export { TOOLS_INTRO_KEY } from './review-tools'

/** A phone, or a phone on its side: a card beside a mark has no room, so it comes up from the bottom edge. */
const DOCKED_CARDS = '(max-width: 639px), (pointer: coarse) and (max-height: 500px)'

/**
 * Where a proposal stands in the walk through Piloti's proposals: its place
 * among the proposals on this Fassung, in the order J and „Durchgehen" take
 * them. Null for anything that is not one of them.
 */
export function walkPosition(
  annotations: readonly Pick<AnnotationView, 'id' | 'status' | 'onCurrentRevision'>[],
  id: string | null
): { index: number; total: number } | null {
  const walk = annotations.filter((annotation) => annotation.status === 'proposed' && annotation.onCurrentRevision)
  const index = walk.findIndex((annotation) => annotation.id === id)
  return index === -1 ? null : { index: index + 1, total: walk.length }
}

/** Whether a key press belongs to a field the reader is typing in. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

/** Whether a key press is the stage's: focus in a Skizze's canvas, whose V, R, E, ⌫ and Esc are Excalidraw's. */
const stageKeys = (target: EventTarget | null) => target instanceof Element && target.closest('[data-stage-keys]') !== null

/** Where a colleague is from this reader's view: in it, or past its top or bottom edge. */
export type PeerSide = 'here' | 'above' | 'below'

/**
 * Where a colleague's point is from the reader's view. Measured where the
 * page is laid out (`pageRect`, the view's `top`/`bottom`, all in the
 * window): their point is on screen or past an edge, so a colleague on the
 * next page whose pointer is in plain sight gets no chip. A page that is not
 * laid out is told by its number against the reader's page.
 */
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

/** Re-render on every scroll inside `ref`, once a frame at most: what is on screen moved. */
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

/**
 * The people out of this reader's view, at the edge of the sheet that leads
 * to them, the way a design tool keeps a colleague's pointer at the edge of
 * the canvas when it is off-screen. A chip jumps there; following stays the
 * face's. `edge` is the one edge this instance draws.
 *
 * Never over the open card: the card lives in the page's scroller, which no
 * z-index lifts above these, so the card keeps out of the foot (`fitCard`) and
 * a row that would still lie over it (the reader scrolled the card under it)
 * steps aside until it is clear.
 */
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
  /** The canvas the pages are laid out in, to tell what is on screen. */
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
  // Its own subscription: where people are moves with every pointer, and only these chips redraw for it.
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
        <PeerTag key={state.peer.userId} asChild color={identityInk(state.peer.userId)}>
          <button
            type="button"
            data-testid="review-elsewhere"
            aria-label={t('review.elsewhereJump', { name: state.peer.name, page: at })}
            title={t('review.elsewhereJump', { name: state.peer.name, page: at })}
            onClick={() => onJump(state)}
            className={cn('pointer-events-auto outline-none', FOCUS_RING)}
          >
            <Arrow aria-hidden />
            {t('review.elsewhere', { name: state.peer.name.split(/\s+/)[0] ?? state.peer.name, page: at })}
          </button>
        </PeerTag>
      ))}
    </div>
  )
}

/**
 * The focused review of one document: the sheet, the marks on it, the threads
 * under them, and the people looking at it with you.
 *
 * Built for two moments an architect has with a drawing. Alone, with time: go
 * through a Fachplaner's sheet and leave what you find exactly where you found
 * it, without a form in the way (C, click, type, Enter). Together: a Jour fixe
 * or a call where everybody looks at the same sheet, sees each other's
 * pointers, follows whoever is talking, and watches the marks land. Piloti is
 * in the room as a colleague: asked about a box (P, or from a draft or a
 * thread), it answers beside it; asked to review the document, it works
 * through it with its own pointer, and its findings arrive as proposals that
 * count only once a person takes one over.
 *
 * Everything else of the workspace is gone while it is open (a full-screen
 * `Dialog`, the overlay the design language gives an artifact looked at with
 * full attention). Escape steps back one thing at a time: the draft, the tool,
 * the open thread, and only then the review itself.
 */
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
  openCreated = null,
  stage: stageContent = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  review: ReviewState
  documentName: string
  /** „Fassung 3", when the document has Fassungen to tell apart. */
  revisionLabel?: string | null
  canPickAssignee: boolean
  /** A mark to open at, or a page (a Skizze's „Zur Seite N“), when the review was entered at one. */
  focusRequest?: { annotationId: string | null; page?: number | null; key: number } | null
  /** The review on a page of its own: offered as a window of its own, and as a link to send. */
  popoutHref?: string | null
  /** A tool to have in hand once the review opens (entered by „Anmerken"). */
  initialTool?: ReviewTool
  /** The page the reader is on, as it changes: the file preview opens there again once the review closes. */
  onPage?: (page: number) => void
  /**
   * Where „Protokoll exportieren" may file the Protokoll as a document; null where it has no place (not a
   * project's, archived, a closed project). Offered only to a reader who may write the document's folder.
   */
  protocolFiling?: ProtocolFilingTarget | null
  /** Opens a document the page menu made (a Skizze on this page) with its own review; null offers no page menu. */
  openCreated?: ((documentId: string) => void) | null
  /**
   * What stands where the PDF's pages would: a Skizze's canvas (`ReviewStageProps`). A stage owns its
   * pointer, its tools and its keys, so the review's page tools, own cursor, follow and page chips step
   * aside; the header, the list, the cards, the Protokoll and Piloti stay the review's.
   */
  stage?: ((slots: ReviewStageSlots) => ReactNode) | null
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [focus, setFocus] = useState<{ page: number; y: number; key: string; instant?: boolean } | null>(null)
  const [following, setFollowing] = useState<string | null>(null)
  const { annotations, select, setTool, tool, selectedId, draft, setDraft, room, piloti } = review
  /**
   * The page this reader is on (the one crossing the middle of the view), for
   * who is elsewhere. Null until the viewer first reports: it opens on page 1.
   */
  const [viewPage, setViewPage] = useState<number | null>(null)
  /** Where the middle of the reader's view is, for the keyboard's crosshair to start there. */
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
  /** What the toolbars and the chips below take of the canvas's foot, kept free for the cursor chat and the review's toasts. */
  const foot = touch ? STAGE_FOOT.touch : STAGE_FOOT.pointer
  /** The canvas less its head and foot: where a card on the sheet keeps. */
  const stage = useCallback<StageBounds>(() => {
    const box = canvasRef.current?.getBoundingClientRect()
    return box ? { top: box.top + STAGE_HEAD, bottom: box.bottom - foot } : null
  }, [foot])
  /**
   * Cursor chat („/"): open, and where this reader's pointer last was, to open
   * it there. From the toolbar's button there is no pointer to open at (the
   * hand is on the button): the bubble opens centred over the sheet.
   */
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
  const openAsk = piloti.asks.find((ask) => ask.id === piloti.openId) ?? null
  // From `lg` the list is a column beside the sheet; below it, a sheet from the
  // bottom edge behind a header button (a phone on its side is 852px, under `lg`).
  const listBeside = useMediaQuery('(min-width: 1024px)')
  const [listOpen, setListOpen] = useState(false)
  // On a phone a card beside its mark runs off the screen: it comes up from the bottom edge instead.
  const docked = useMediaQuery(DOCKED_CARDS)

  /**
   * The tools spelled out, the first time a browser opens a review: every
   * tool with its name and key. Folded after the first mark or by its ×.
   */
  const [intro, setIntro] = useState(false)
  useEffect(() => {
    if (open && !touch && !stageContent && !toolsIntroSeen()) setIntro(true)
  }, [open, touch, stageContent])
  const foldIntro = useCallback(() => {
    setIntro(false)
    rememberToolsIntro()
  }, [])
  useEffect(() => {
    if (intro && (draft || openAsk)) foldIntro()
  }, [intro, draft, openAsk, foldIntro])

  // The review is open: the document's rows about new marks are read, which no pin's dot carries,
  // and so are those that arrive while it stays open.
  const { watchMarksSetNews } = review
  useEffect(() => (open ? watchMarksSetNews() : undefined), [open, watchMarksSetNews])

  // Entered with a tool in hand: armed once per opening.
  const armed = useRef(false)
  useEffect(() => {
    if (!open) {
      armed.current = false
      return
    }
    // Not before the reader's rights are known: the tools are offered once the list has said so.
    if (armed.current || !initialTool || stageContent || !toolOffered(initialTool, review)) return
    armed.current = true
    setTool(initialTool)
  }, [open, initialTool, review, setTool, stageContent])

  const bring = useCallback(
    (annotation: AnnotationView) => {
      setFollowing(null)
      setDraft(null)
      select(annotation.id)
      // A ghost (an open mark of an earlier Fassung) is drawn where it stood: the view goes there too.
      if (annotation.onCurrentRevision || isGhostMark(annotation, review.documentId)) {
        setFocus({ page: annotation.page, y: annotation.y + (annotation.h ?? 0) / 2, key: `${annotation.id}:${Date.now()}` })
      }
    },
    [select, setDraft, review.documentId]
  )

  /**
   * The focus, for a reader on the keyboard. A card opened by a key (J, K, Enter
   * on a pin or a row) takes the focus itself: it is a dialog named by its
   * header, so it is announced, and no Enter lands on „Erledigen" by accident.
   * What had the focus is kept, and gets it back when the card closes (its ×,
   * Escape). Each key's ask is counted, so a key that lands on the card already
   * open is answered at once and leaves nothing behind for a later click. The
   * keyboard's crosshair returns the focus the same way when the tool is put down.
   */
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

  /** The keyboard's crosshair: a mark tool taken up by a key sets its place with the arrows. */
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
    // Put down, or the mark set and its card closed: the focus goes back to where the tool was taken up.
    const trigger = aimTrigger.current
    aimTrigger.current = null
    if (!trigger) return
    const frame = requestAnimationFrame(() => restoreFocus(trigger))
    return () => cancelAnimationFrame(frame)
  }, [tool, aim])

  /**
   * Going through Piloti's proposals („Durchgehen"): the proposal in hand. A
   * decision on it moves to the next one; choosing anything else ends the walk.
   */
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
    // Taken over or dismissed: on to the next, or the walk is done.
    const next = review.step(1, 'proposed')
    setWalking(next?.id ?? null)
    if (next) bring(next)
  }, [walking, selectedId, annotations, review, bring])
  const walk = walking ? walkPosition(annotations, walking) : null
  /** A row of the list chosen: its mark brought into view, its card focused when a key chose it. */
  const openFromList = useCallback<OpenMark>(
    (annotation, byKeyboard) => {
      if (byKeyboard) focusNextCard()
      bring(annotation)
    },
    [bring, focusNextCard]
  )

  // Entered from a mark: open at it, once per request, as soon as the list holds it.
  const handled = useRef<number | null>(null)
  useEffect(() => {
    if (!open || !focusRequest || handled.current === focusRequest.key) return
    const { page } = focusRequest
    if (!focusRequest.annotationId && page) {
      handled.current = focusRequest.key
      return setFocus({ page, y: 0, key: `page:${page}:${focusRequest.key}`, instant: true })
    }
    const target = annotations.find((annotation) => annotation.id === focusRequest.annotationId)
    if (!target) return
    handled.current = focusRequest.key
    bring(target)
  }, [open, focusRequest, annotations, bring])

  // Following: the view goes where theirs goes. Read off the room by what it needs, so
  // their pointer moving does not re-render the review; their view moving does.
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

  const forceClose = useCallback(() => {
    setFollowing(null)
    setDraft(null)
    setTool('select')
    onOpenChange(false)
  }, [onOpenChange, setDraft, setTool])
  /** The stage's say before closing (a Skizze's unsaved strokes), and where its header controls go. */
  const closeGuard = useRef<(() => boolean) | null>(null)
  const setCloseGuard = useCallback((guard: (() => boolean) | null) => void (closeGuard.current = guard), [])
  const close = useCallback(() => {
    if (closeGuard.current && !closeGuard.current()) return
    forceClose()
  }, [forceClose])
  const [stageSlot, setStageSlot] = useState<HTMLElement | null>(null)

  // A mark of an earlier Fassung is not drawn as a mark of this sheet (an open
  // one is a ghost, where it stood on its own): selected, its thread opens over
  // the sheet, never beside a place the current drawing may not have.
  const earlier = annotations.find((annotation) => annotation.id === selectedId && !annotation.onCurrentRevision) ?? null
  const selected = annotations.find((annotation) => annotation.id === selectedId) ?? null
  // The card a phone docks: Piloti's answer on a box, the draft, or the open thread.
  const dockedAsk = openAsk && openAsk.region && !openAsk.replyInThread ? openAsk : null
  const dockOpen = docked && Boolean(dockedAsk || draft || selected)
  const closeCard = useCallback(() => {
    if (dockedAsk) {
      if (dockedAsk.status === 'thinking') piloti.open(null)
      else piloti.dismiss(dockedAsk.id)
    } else if (draft) setDraft(null)
    else select(null)
  }, [dockedAsk, piloti, draft, setDraft, select])

  /**
   * Escape steps back one thing at a time: Piloti's card, the draft, following,
   * the tool, the open thread, and only then the review itself. It runs as the
   * dialog's own Escape (Radix hears the key first, on the document, and only
   * for the topmost layer: an open menu or sheet takes its own Escape). In a
   * field it is the field's, unless there is a draft or a card to let go of.
   */
  const stepBack = (event: KeyboardEvent) => {
    event.preventDefault()
    if (stageKeys(event.target) && !draft && !openAsk) return
    if (typing(event.target) && !draft && !openAsk) return
    if (openAsk) piloti.open(null)
    else if (draft) setDraft(null)
    else if (following) setFollowing(null)
    else if (tool !== 'select') setTool('select')
    else if (selectedId) select(null)
    else close()
  }

  /**
   * A key's decision is a moment from the server (`review.decide`): the toast
   * names it and offers „Rückgängig", which lets it go before it is sent, as
   * the inbox's archive does. A key is easy to hit by mistake; a click on the
   * card's own button is not, and goes at once.
   */
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

  // Letters pick tools and walk the marks. The handler reads this render's state
  // through a ref: the listener is attached once per opening, not on every change.
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    // The list's sheet, and a phone's card sheet, are layers of their own: their keys are their own.
    if (listOpen || dockOpen) return
    if (event.key === 'Escape' || typing(event.target) || stageKeys(event.target)) return
    const key = event.key.toLowerCase()
    // A stage has its own tools: the review's letters for them are its own there.
    if (stageContent && (key === '/' || key === 'v' || key === 'c' || key === 'r' || key === 'p')) return
    if (key === '/') openChat(true)
    else if (key === 'v') setTool('select')
    else if ((key === 'c' || key === 'r') && review.canAnnotate) {
      setTool(key === 'c' ? 'point' : 'region')
      startAim()
    } else if (key === 'p' && piloti.available) {
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
      // ⌫ on „Verwerfen" says it: a proposal in hand is dismissed, nothing else is.
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

  /** A link that opens the review at this mark, on the clipboard; a refusal says so. */
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
  /**
   * The mark's own link: the document on its shelf at the review (`popoutHref`), else this page,
   * with `doc`, `review` and `mark` and nothing of this tab's way through it: neither the tool in
   * hand nor `back`, the page this reader came from, which is not the recipient's.
   */
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

  /** The card for whatever is in hand, wherever it is shown. */
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

  // What the tool in hand does next, said once at the top of the canvas.
  // With the keyboard's crosshair out, the keys that move and set it.
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
      hasProposals={annotations.some((annotation) => annotation.authorKind === 'piloti' && !annotation.acceptedBy)}
      // Filing is an upload into the document's folder: offered to whoever may write there, which is
      // what `canAnnotate` says (the document's write, folder included, ADR-0088). The upload checks again.
      filing={protocolFiling && review.canAnnotate ? { target: protocolFiling, documentName } : null}
    />
  )
  const checkFixed = useCheckFixed(review, { documentName, revisionLabel: revisionLabel ?? null })

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={stepBack}
        // The sheet is what has focus to begin with, not the close button: a
        // ring on the X is the first thing an opened review would say.
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="bg-background inset-0 top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        data-testid="document-review"
      >
        <ReviewHeader
          review={review}
          documentName={documentName}
          revisionLabel={revisionLabel}
          onClose={close}
          following={following}
          onFollow={stageContent ? undefined : setFollowing}
          pageMenu={stageContent ? null : <ReviewPageMenu documentId={review.documentId} page={viewPage ?? 1} onCreated={openCreated} />}
          popoutHref={popoutHref}
          onPopout={popout}
          onCopyText={copyText}
          listBeside={listBeside}
          listOpen={listOpen}
          onListOpen={() => setListOpen(true)}
          exportMenu={exportMenu}
          onWalk={walkProposals}
          stageSlot={stageContent ? setStageSlot : undefined}
        />

        <ReviewStageContext.Provider value={stage}>
          <div className="flex min-h-0 flex-1">
            <div
              ref={canvasRef}
              className={cn('relative min-w-0 flex-1', OWN_CURSOR_ZONE)}
              data-testid="review-canvas"
              onWheelCapture={() => following && setFollowing(null)}
              onPointerDownCapture={() => following && setFollowing(null)}
              onPointerMove={(event) => void (lastPointer.current = { x: event.clientX, y: event.clientY })}
            >
              {!stageContent && <OwnCursor canvas={canvasRef} userId={room.self?.userId ?? null} name={room.self?.name ?? ''} tool={tool} />}
              {/* What sits at the top of the canvas, one under the other: whom the
                  view follows, who is out of view above, what the tool in hand does. */}
              <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex flex-col items-center gap-1.5">
                {followedState && (
                  <PeerTag color={identityInk(followedState.userId)} role="status">
                    {t('review.following', { name: followedState.name })}
                  </PeerTag>
                )}
                {!stageContent && <Elsewhere review={review} page={viewPage ?? 1} edge="above" canvas={canvasRef} onJump={jumpTo} />}
                {toolHint && (
                  // With the crosshair out its own label says the keys in words; the glyphs here would be read on top of it.
                  <FloatingNote role={aim ? undefined : 'status'} aria-hidden={aim ? true : undefined} data-testid="review-tool-hint">
                    {toolHint}
                  </FloatingNote>
                )}
              </div>
              {!stageContent && <Elsewhere review={review} page={viewPage ?? 1} edge="below" canvas={canvasRef} onJump={jumpTo} />}
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
                  // Above the viewer's pill and the chips of who is below, and on a
                  // touch screen above the tools over the pill too.
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
              {touch && !stageContent && (
                // On a touch screen the tools sit centred ABOVE the viewer's own
                // pill, at the thumb, each with its name under it.
                <FloatingToolbar className="pointer-events-auto absolute bottom-[4.75rem] left-1/2 z-30 -translate-x-1/2">
                  {toolsPalette('touch')}
                </FloatingToolbar>
              )}
              {stageContent ? stageContent({ headerSlot: stageSlot, setCloseGuard, close: forceClose, cardsDocked: docked }) : <PdfDocumentView
                src={documentFileUrl(review.documentId)}
                title={documentName}
                focus={focus}
                onViewport={onViewport}
                // With a pointer, the tools lead the viewer's own pill: one bar at the foot.
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
              />}
              <ReviewToaster foot={foot} />
            </div>
            <ReviewPanel review={review} onOpen={openFromList} onWalkProposals={walkProposals} onCheckFixed={checkFixed} />
          </div>
        </ReviewStageContext.Provider>
        {docked && (
          // Not modal: no veil over the drawing the card is about, and the page
          // stays in reach (another pin, a pinch). Only its × and Escape close it.
          <Sheet open={dockOpen} modal={false} onOpenChange={(next) => !next && closeCard()}>
            <SheetContent
              side="bottom"
              closeLabel={t('review.closeThread')}
              data-testid="review-card-sheet"
              onInteractOutside={(event) => event.preventDefault()}
              // The sheet is the card's frame: no second border inside it.
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
                // Choosing a mark shows it: the sheet steps aside for the page.
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
      </DialogContent>
    </Dialog>
  )
}

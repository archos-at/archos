'use client'

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { toast } from 'sonner'
import { PageDialog, PageDialogContent } from '@/components/ui/page-dialog'
import { identityInk } from '@/components/ui/avatar-identity'
import { FloatingNote, FloatingToolbar } from '@/components/ui/floating-toolbar'
import { useMediaQuery } from '@/hooks/use-media-query'
import { PdfDocumentView } from '@/features/knowledge/components/pdf-document-view'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { isGhostMark, type AnnotationView } from '@/lib/annotations/types'
import { documentFileUrl } from '@/lib/documents/urls'
import { sameValue } from '@/lib/utils/same-value'
import { isAgentKind } from '@/lib/agent-kind'
import { DECISION_UNDO_MS, type DocumentReview as ReviewState, type ReviewTool } from '../../hooks/use-document-review'
import { useRoomSelector, type RoomPeerState } from '../../hooks/use-document-room'
import { CursorChat } from './cursor-chat'
import { keepTrigger, restoreFocus } from './focus-return'
import { AgentAnswerCard } from './agent-answer-card'
import { ReviewPageLayer } from './review-page-layer'
import { ReviewPanel, type OpenMark } from './review-panel'
import { useReviewList } from './review-list'
import { ReviewAnnouncer } from './review-announcer'
import { ReviewExportMenu } from './review-export-menu'
import type { ProtocolFilingTarget } from '../../lib/protocol-filing'
import { useCheckFixed } from './check-fixed'
import { ReviewToaster, reviewToast } from './review-toaster'
import { clearReviewParams, setReviewParams } from '../../lib/open-review'
import { ReviewStageContext, STAGE_FOOT, STAGE_HEAD, type StageBounds } from './review-stage'
import { DraftCard, ThreadCard, type CardPlacement } from './thread-card'
import { rememberToolsIntro, toolsIntroSeen } from '../../lib/review-tools-intro'
import { toolOffered } from '../../lib/offered-tools'
import { walkPosition } from '../../lib/proposal-walk'
import { pageOf } from '../../lib/review-peers'
import { typing } from '../../lib/typing-target'
import { ReviewHeader } from './document-review/review-header'
import { ReviewCardSheet } from './document-review/review-card-sheet'
import { ReviewListSheet } from './document-review/review-list-sheet'
import { Elsewhere } from './document-review/elsewhere'
import { ReviewTools } from './document-review/review-tools'

export { TOOLS_INTRO_KEY, toolsIntroSeen } from '../../lib/review-tools-intro'
export { walkPosition } from '../../lib/proposal-walk'
export { people, peerSide, roomCompanyOf } from '../../lib/review-peers'
export type { PeerSide, RoomCompany } from '../../lib/review-peers'
export { useRoomCompany } from '../../hooks/use-room-company'
export { Presence } from './document-review/presence'

const DOCKED_CARDS = '(max-width: 639px), (pointer: coarse) and (max-height: 500px)'

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
        <ReviewHeader
          review={review}
          documentName={documentName}
          revisionLabel={revisionLabel}
          close={close}
          following={following}
          setFollowing={setFollowing}
          popoutHref={popoutHref}
          popout={popout}
          copyText={copyText}
          list={list}
          exportMenu={exportMenu}
          walkProposals={walkProposals}
          agentOffered={agent.available && review.canAnnotate}
        />

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
          <ReviewCardSheet
            review={review}
            documentName={documentName}
            dockOpen={dockOpen}
            closeCard={closeCard}
            dockedAsk={dockedAsk}
            threadCard={threadCard}
          />
        )}
        {!listBeside && (
          <ReviewListSheet
            review={review}
            documentName={documentName}
            listOpen={listOpen}
            setListOpen={setListOpen}
            exportMenu={exportMenu}
            openFromList={openFromList}
            walkProposals={walkProposals}
            checkFixed={checkFixed}
          />
        )}
        <ReviewAnnouncer review={review} />
      </PageDialogContent>
    </PageDialog>
  )
}

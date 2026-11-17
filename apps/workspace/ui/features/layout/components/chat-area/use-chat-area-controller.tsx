import { useRef, useEffect, useLayoutEffect, useCallback, useState, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '@/features/chat/store'

import type { ChatMessage } from '@/features/chat/types'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { useAnswerRevealStore } from '@/features/chat/stores/answer-reveal-store'
import type { UserMessageAuthor } from '@/features/chat/components/UserMessage'
import type { Finding } from '@/lib/conversations/message-findings'
import { useCommissionRun } from '@/features/runs/hooks/use-commission-run'
import { continuationBrief, findingBrief } from '@/features/runs/lib/carry-forward'
import { AGENT_MENTION_ID } from '@/lib/mentions/types'
import { useMessageAnchor } from '@/features/collaboration/hooks/use-message-anchor'
import { useSharedThread } from '@/features/collaboration/hooks/use-shared-thread'
import { useSpectatedTurn } from '@/features/collaboration/hooks/use-spectated-turn'
import { useAwaitingState } from '@/features/collaboration/hooks/use-sharing'
import { motionEntrance, motionInstant, motionQuickExit } from '@/components/motion'
import type { Variants } from 'motion/react'
import { glideScrollTo, type GlideHandle } from '../../lib/glide-scroll'
import { useAuth } from '@/adapters/auth'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { researchCopy } from '@/i18n/namespaces/research'
import { useShowReasoningSkills } from '@/lib/user-preferences/use-show-reasoning-skills'
import {
  isDisplayableMessage,
  isTransientConnectionError,
  selectThreadPhase,
} from '../../lib/thread-phase'
import {
  readThreadPosition,
  rememberThreadPosition,
  type ThreadPosition,
} from '../../lib/thread-positions'
import {
  answerGist,
  turnEnding,
  RECONNECTED_NOTE_MS,
  ROW_GAP_PX,
  FOLD_HOLD_MS,
  UNSEEN_SLACK_PX,
  READER_SCROLL_MS,
  GESTURE_SETTLE_MS,
  RETRY_ANCHOR_WINDOW_MS,
  layoutTop,
  visibleBottom,
} from './chat-area-helpers'

export interface ChatAreaProps {
  isAuthenticated?: boolean
  onSignIn?: () => void
  canCollaborate?: boolean
}

export function useChatAreaController({
  isAuthenticated = false,
  onSignIn,
  canCollaborate = false,
}: ChatAreaProps) {
  const { currentConversation, isStreaming, currentUserMessageId, isRecoveryPending } =
    useChatStore(
      useShallow((s) => ({
        currentConversation: s.currentConversation,
        isStreaming: s.isStreaming,
        currentUserMessageId: s.currentUserMessageId,
        isRecoveryPending: s.isRecoveryPending,
      }))
    )
  const threadPhase = useChatStore(selectThreadPhase)
  const pendingMessagesFor = useChatStore((s) => s.pendingMessagesFor)
  const setPendingMessagesFor = useChatStore((s) => s.setPendingMessagesFor)
  const revealingId = useAnswerRevealStore((s) => s.revealingId)
  const turnLive = isStreaming || revealingId !== null
  const turns = useChatStore((s) => s.turns)
  const failedTurnIdsRef = useRef(new Set<string>())
  useEffect(() => {
    if (typeof useChatStore.subscribe !== 'function') return
    return useChatStore.subscribe((state) => {
      for (const view of Object.values(state.turns ?? {})) {
        if (view.phase === 'failed') failedTurnIdsRef.current.add(view.turnId)
      }
    })
  }, [])

  const activeProjectId = useChatStore((s) => s.projectId)
  const setComposerPrefill = useChatStore((s) => s.setComposerPrefill)
  const stableStepsRef = useRef(new Map<string, StoredThinkingStep[]>())
  const dismissErrorCard = useChatStore((s) => s.dismissErrorCard)
  const retryLastUserMessage = useChatStore((s) => s.retryLastUserMessage)
  const t = useTranslations(researchCopy)
  const tCollaboration = useTranslations(collaborationCopy)
  const { user } = useAuth()
  const currentUserId = user?.id ?? null
  const { showReasoningSkills } = useShowReasoningSkills()

  const {
    shared,
    myRole,
    loading: sharedLoading,
    accessLost,
    turnInFlight,
    clearTurnInFlight,
    noteTurnActivity,
    typists,
    unreadAfterMessageId,
    lastArrival,
    participants,
    engagement,
    engagementSuggestion,
    setEngagement,
    authorOf,
  } = useSharedThread({
    conversationId: currentConversation?.id ?? null,
    enabled: canCollaborate,
    currentUserId,
  })

  const isForeignTurn = Boolean(
    shared && turnInFlight && turnInFlight.actorUserId !== currentUserId && !isStreaming
  )
  const { turn: spectatedTurn, live: spectatingLive } = useSpectatedTurn({
    conversationId: currentConversation?.id ?? null,
    enabled: isForeignTurn,
    onFrame: noteTurnActivity,
  })

  useEffect(() => {
    if (isForeignTurn && spectatedTurn?.phase === 'failed') clearTurnInFlight()
  }, [isForeignTurn, spectatedTurn?.phase, clearTurnInFlight])

  const turnInFlightLabel = useMemo(() => {
    if (!turnInFlight) return ''
    if (turnInFlight.actorUserId && turnInFlight.actorUserId === currentUserId) {
      return tCollaboration('thread.turnInFlightYou')
    }
    return tCollaboration('thread.turnInFlight', {
      name: authorOf(turnInFlight.actorUserId)?.name ?? tCollaboration('inbox.unknownActor'),
    })
  }, [turnInFlight, currentUserId, authorOf, tCollaboration])

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
  const instantExitIdsRef = useRef(new Set<string>())
  const [showScrollButton, setShowScrollButton] = useState(false)

  const anchorSpacerRef = useRef<HTMLDivElement>(null)
  const anchoredRef = useRef(false)
  const prefersReducedMotion = useReducedMotion()
  const reducedMotionRef = useRef(prefersReducedMotion)
  reducedMotionRef.current = prefersReducedMotion

  const rowEnter = prefersReducedMotion ? motionInstant : motionEntrance
  const rowLeave = prefersReducedMotion ? motionInstant : motionQuickExit
  const rowVariants = useMemo<Variants>(
    () => ({
      hidden: { opacity: 0, y: 4 },
      shown: () => ({
        opacity: 1,
        y: 0,
        transition: reducedMotionRef.current ? motionInstant : motionEntrance,
      }),
      leave: (id: string) => ({
        opacity: 0,
        height: 0,
        marginTop: -ROW_GAP_PX,
        overflow: 'hidden',
        transition:
          instantExitIdsRef.current.has(id) || reducedMotionRef.current
            ? motionInstant
            : motionQuickExit,
      }),
    }),
    []
  )

  const messages = currentConversation?.messages
  const commissionRun = useCommissionRun(activeProjectId ?? null, currentConversation?.id ?? null)
  const commissionFromFinding = useCallback(
    async (finding: Finding): Promise<boolean> => {
      if (!commissionRun) return false
      const brief = findingBrief(finding)
      return commissionRun.commission(brief.question, brief.context)
    },
    [commissionRun]
  )
  const continueRun = useCallback(
    async (message: ChatMessage): Promise<void> => {
      if (!commissionRun) return
      const brief = continuationBrief(message)
      await commissionRun.commission(brief.question, brief.context, brief.documents)
    },
    [commissionRun]
  )

  const displayableMessages = useMemo(
    () => (messages ?? []).filter(isDisplayableMessage),
    [messages]
  )
  const connectionLost = useMemo(
    () => (messages ?? []).some(isTransientConnectionError),
    [messages]
  )

  const isEmpty = displayableMessages.length === 0
  const sharedHistoryPending = shared && sharedLoading && isEmpty
  const showSkeleton =
    threadPhase === 'hydrating' || threadPhase === 'loading' || sharedHistoryPending
  const listReady = !showSkeleton
  const sharedPendingClaimRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    const id = currentConversation?.id ?? null
    if (sharedHistoryPending && id) {
      if (sharedPendingClaimRef.current === id || pendingMessagesFor === id) return
      sharedPendingClaimRef.current = id
      setPendingMessagesFor?.(id)
      return
    }
    const claimed = sharedPendingClaimRef.current
    if (!claimed) return
    sharedPendingClaimRef.current = null
    if (pendingMessagesFor === claimed) setPendingMessagesFor?.(null)
  }, [sharedHistoryPending, currentConversation?.id, pendingMessagesFor, setPendingMessagesFor])
  const skeletonShownRef = useRef(showSkeleton)
  const listArrivesFromSkeleton = skeletonShownRef.current
  useEffect(() => {
    skeletonShownRef.current = showSkeleton
  }, [showSkeleton])

  const [connectionNote, setConnectionNote] = useState<'lost' | 'restored' | null>(
    connectionLost ? 'lost' : null
  )
  const [connectionSeen, setConnectionSeen] = useState({
    conversationId: currentConversation?.id,
    lost: connectionLost,
  })
  if (connectionSeen.conversationId !== currentConversation?.id) {
    setConnectionSeen({ conversationId: currentConversation?.id, lost: connectionLost })
    setConnectionNote(connectionLost ? 'lost' : null)
  } else if (connectionSeen.lost !== connectionLost) {
    setConnectionSeen({ conversationId: currentConversation?.id, lost: connectionLost })
    setConnectionNote(connectionLost ? 'lost' : 'restored')
  }
  useEffect(() => {
    if (connectionNote !== 'restored') return
    const timer = setTimeout(() => setConnectionNote(null), RECONNECTED_NOTE_MS)
    return () => clearTimeout(timer)
  }, [connectionNote])

  const anchoredMessageIds = useMemo(
    () => displayableMessages.map((m) => m.id),
    [displayableMessages]
  )
  const deepLinkedConversationRef = useRef<string | undefined>(undefined)
  const { highlightedId: highlightedMessageId, isTargetPending } = useMessageAnchor(
    anchoredMessageIds,
    {
      conversationId: currentConversation?.id ?? null,
      ready: listReady && !sharedLoading,
      onLand: () => {
        deepLinkedConversationRef.current = currentConversation?.id
        glideRef.current?.stop()
        followRef.current = false
        jumpedRef.current = false
      },
    }
  )

  const authorship = useMemo(() => {
    const byMessageId = new Map<string, { author: UserMessageAuthor; grouped: boolean }>()
    if (!shared) return byMessageId

    let previousAuthorKey: string | null = null
    for (const message of displayableMessages) {
      const isUserMessage = message.messageType === 'user' || message.role === 'user'
      if (!isUserMessage) {
        previousAuthorKey = null
        continue
      }

      const userId = message.authorUserId ?? currentUserId ?? null
      const person = authorOf(userId)
      const key = userId ?? `unattributed:${message.id}`

      byMessageId.set(message.id, {
        author: {
          userId,
          name: person?.name ?? message.authorName ?? null,
          avatarUrl: person?.profilePictureUrl ?? message.authorAvatarUrl ?? null,
          isYou: Boolean(userId && currentUserId && userId === currentUserId),
        },
        grouped: key === previousAuthorKey,
      })
      previousAuthorKey = key
    }
    return byMessageId
  }, [shared, displayableMessages, authorOf, currentUserId])

  const unreadDividerBeforeId = useMemo(() => {
    if (!shared || !unreadAfterMessageId) return null
    const all = messages ?? []
    const anchorIndex = all.findIndex((m) => m.id === unreadAfterMessageId)
    if (anchorIndex < 0) return null
    const displayableIds = new Set(displayableMessages.map((m) => m.id))
    for (const message of all.slice(anchorIndex + 1)) {
      if (!displayableIds.has(message.id)) continue
      const mine = authorship.get(message.id)?.author.isYou === true
      if (!mine) return message.id
    }
    return null
  }, [shared, unreadAfterMessageId, messages, displayableMessages, authorship])

  const { awaiting, release } = useAwaitingState(
    currentConversation?.id ?? null,
    canCollaborate && shared
  )
  const threadAwaitsHuman = (awaiting?.pending.length ?? 0) > 0

  const [handbackDismissedFor, setHandbackDismissedFor] = useState<string | null>(null)

  const handback = useMemo((): {
    anchorId: string
    people: Array<{ userId: string; name: string }>
  } | null => {
    if (!shared || threadAwaitsHuman) return null

    const asked = new Set<string>()
    for (const message of displayableMessages) {
      if (message.addressees) {
        if (!message.addressees.agent) {
          for (const userId of message.addressees.users) asked.add(userId)
        }
        continue
      }
      const mentions = message.mentions ?? []
      if (mentions.length === 0) continue
      if (mentions.some((mention) => mention.targetId === AGENT_MENTION_ID)) continue
      for (const mention of mentions) asked.add(mention.targetId)
    }
    if (asked.size === 0) return null

    const answerers: Array<{ userId: string; name: string }> = []
    let anchorId: string | null = null
    for (let index = displayableMessages.length - 1; index >= 0; index -= 1) {
      const message = displayableMessages[index]
      const isUserMessage = message.messageType === 'user' || message.role === 'user'
      if (!isUserMessage) break
      const userId = message.authorUserId ?? null
      if (!userId || userId === currentUserId || !asked.has(userId)) break
      anchorId ??= message.id
      if (answerers.some((person) => person.userId === userId)) continue
      answerers.unshift({
        userId,
        name: authorOf(userId)?.name ?? message.authorName ?? tCollaboration('inbox.unknownActor'),
      })
    }
    if (!anchorId || answerers.length === 0) return null
    return { anchorId, people: answerers }
  }, [shared, threadAwaitsHuman, displayableMessages, currentUserId, authorOf, tCollaboration])

  const showHandback = handback !== null && handbackDismissedFor !== handback.anchorId

  const handleHandback = useCallback(() => {
    if (!handback) return
    const agentName = tCollaboration('mentions.picker.agentName')
    setComposerPrefill(`@${agentName} ${tCollaboration('mentions.handback.prefill')}`, [
      { targetId: AGENT_MENTION_ID, display: agentName },
    ])
    setHandbackDismissedFor(handback.anchorId)
  }, [handback, setComposerPrefill, tCollaboration])

  const handleAskAgent = useCallback(() => {
    const agentName = tCollaboration('mentions.picker.agentName')
    setComposerPrefill(`@${agentName} `, [{ targetId: AGENT_MENTION_ID, display: agentName }])
  }, [setComposerPrefill, tCollaboration])

  const handleAskBack = useCallback(
    (asker: { userId: string; name: string }) => {
      setComposerPrefill(`@${asker.name} `, [{ targetId: asker.userId, display: asker.name }])
    },
    [setComposerPrefill]
  )

  const hydratedIdsRef = useRef<Set<string> | null>(null)
  const hydratedRailIdsRef = useRef(new Set<string>())
  const hydratedConversationIdRef = useRef<string | undefined>(currentConversation?.id)
  const hydratedListReadyRef = useRef(listReady)
  const liveShownIdsRef = useRef(new Set<string>())
  if (
    hydratedIdsRef.current === null ||
    hydratedConversationIdRef.current !== currentConversation?.id ||
    hydratedListReadyRef.current !== listReady
  ) {
    const sameThread = hydratedConversationIdRef.current === currentConversation?.id
    hydratedConversationIdRef.current = currentConversation?.id
    hydratedListReadyRef.current = listReady
    hydratedIdsRef.current = new Set(displayableMessages.map((m) => m.id))
    hydratedRailIdsRef.current = new Set(
      displayableMessages.filter((m) => m.stages?.followUps).map((m) => m.id)
    )
    if (!sameThread) liveShownIdsRef.current = new Set()
  }
  const hydratedIds = hydratedIdsRef.current
  if (spectatedTurn?.messageId) hydratedIds.add(spectatedTurn.messageId)

  const threadLayout = useMemo(() => {
    const turnOf = new Map<string, ChatMessage[]>()
    const rowKeyOf = new Map<string, string>()
    let question: ChatMessage | null = null
    let answerKeyed = false
    for (const message of displayableMessages) {
      if (message.messageType === 'user' || message.role === 'user') {
        question = message
        answerKeyed = false
        turnOf.set(message.id, [])
        continue
      }
      if (!question) continue
      turnOf.get(question.id)?.push(message)
      if (message.messageType === 'agent_response' && !answerKeyed) {
        answerKeyed = true
        rowKeyOf.set(message.id, `answer:${question.id}`)
      }
    }
    return { turnOf, rowKeyOf, lastQuestionId: question?.id ?? null }
  }, [displayableMessages])

  const getStepsForUserMessage = (messageId: string): StoredThinkingStep[] => {
    const steps = (
      currentConversation?.messages.find((m) => m.id === messageId)?.thinkingSteps ?? []
    ).filter((step) => step.scope !== 'deep')
    const previous = stableStepsRef.current.get(messageId)
    if (
      previous &&
      previous.length === steps.length &&
      previous.every((step, i) => step === steps[i])
    ) {
      return previous
    }
    stableStepsRef.current.set(messageId, steps)
    return steps
  }

  const currentTurnHasSteps = currentUserMessageId
    ? getStepsForUserMessage(currentUserMessageId).length > 0
    : false
  const currentTurn = useMemo(() => {
    if (!currentUserMessageId) return null
    const index = displayableMessages.findIndex((m) => m.id === currentUserMessageId)
    if (index < 0) return null
    const rest = displayableMessages.slice(index + 1)
    const nextQuestion = rest.findIndex((m) => m.messageType === 'user' || m.role === 'user')
    const messages = nextQuestion >= 0 ? rest.slice(0, nextQuestion) : rest
    const answer = messages.find((m) => m.messageType === 'agent_response')
    return {
      messages,
      answerId: answer?.id ?? null,
      answerBegun: Boolean(
        answer && (answer.content.trim() || answer.answerMeta || answer.cards?.some(Boolean))
      ),
      stopped: answer?.stopped === true,
      failed: answer?.failed === true,
      gist: answer ? answerGist(answer) : '',
    }
  }, [currentUserMessageId, displayableMessages])

  const [answerBegunFor, setAnswerBegunFor] = useState<string | null>(null)
  if (currentTurn?.answerBegun && currentUserMessageId && answerBegunFor !== currentUserMessageId) {
    setAnswerBegunFor(currentUserMessageId)
  }
  const answerHasBegun =
    Boolean(currentTurn?.answerBegun) ||
    (currentUserMessageId !== null && answerBegunFor === currentUserMessageId)

  const renderedIdsRef = useRef(new Set<string>())
  const foldStarts =
    turnLive &&
    currentTurnHasSteps &&
    currentTurn?.answerBegun &&
    currentTurn.answerId &&
    !hydratedIds.has(currentTurn.answerId) &&
    !renderedIdsRef.current.has(currentTurn.answerId)
      ? currentTurn.answerId
      : null
  const [foldHoldId, setFoldHoldId] = useState<string | null>(null)
  const [releasedHoldId, setReleasedHoldId] = useState<string | null>(null)
  if (foldStarts && foldStarts !== foldHoldId && foldStarts !== releasedHoldId)
    setFoldHoldId(foldStarts)
  useEffect(() => {
    if (!foldHoldId || releasedHoldId === foldHoldId) return
    const timer = setTimeout(
      () => setReleasedHoldId(foldHoldId),
      prefersReducedMotion ? 0 : FOLD_HOLD_MS
    )
    return () => clearTimeout(timer)
  }, [foldHoldId, releasedHoldId, prefersReducedMotion])
  const holdId = foldStarts ?? foldHoldId
  const heldAnswerId = holdId && releasedHoldId !== holdId ? holdId : null

  const [turnNote, setTurnNote] = useState({ live: turnLive, text: '' })
  if (turnNote.live !== turnLive) {
    let text = ''
    if (!turnLive && currentTurn && currentUserMessageId) {
      const view = turns?.[currentUserMessageId]
      const failed =
        currentTurn.failed ||
        view?.phase === 'failed' ||
        failedTurnIdsRef.current.has(currentUserMessageId) ||
        currentTurn.messages.some(
          (m) =>
            m.messageType === 'error' && m.errorData?.errorCode !== 'agent.response_interrupted'
        )
      const ending = turnEnding(view, currentTurn.messages, failed)
      if (currentTurn.stopped) text = t('chatArea.status.stopped')
      else if (ending === 'failed') text = t('chatArea.status.failed')
      else if (ending === 'handed_off') text = t('chatArea.status.handedOff')
      else if (ending === 'refused') text = t('chatArea.status.refused')
      else if (!currentTurn.answerId) text = ''
      else if (currentTurn.gist)
        text = t('chatArea.status.answerReadyWith', { gist: currentTurn.gist })
      else text = t('chatArea.status.answerReady')
    }
    setTurnNote({ live: turnLive, text })
  }
  const stepsPhaseRef = useRef(false)
  stepsPhaseRef.current = turnLive && !answerHasBegun
  const turnLiveRef = useRef(turnLive)
  turnLiveRef.current = turnLive

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

  const shownConversationIdRef = useRef<string | undefined>(undefined)

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
  const positionRafRef = useRef(0)

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
    currentConversation?.id,
  ])

  useEffect(() => () => glideRef.current?.stop(), [])

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
    const questionId = threadLayout.lastQuestionId
    if (!spectatorLive || !questionId) return
    if (!followRef.current && !(anchoredRef.current && sawQuestionArrive(questionId))) return
    setSpectatorAnchor((previous) =>
      previous?.id === questionId ? previous : { id: questionId, sentId: currentUserMessageId }
    )
  }, [spectatorLive, threadLayout.lastQuestionId, currentUserMessageId, sawQuestionArrive])
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
    const id = currentConversation?.id
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
    const lastQuestion = saved ? null : threadLayout.lastQuestionId
    const questionTop = lastQuestion ? rowTop(lastQuestion, { clearToolbar: true }) : null
    if (questionTop !== null && questionTop < end) openAt(Math.max(0, questionTop))
    else openAt(end, { follow: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConversation?.id, listReady, isEmpty])

  const handleScrollToLatest = useCallback(() => {
    glideRef.current?.stop()
    followRef.current = true
    jumpedRef.current = true
    setShowScrollButton(false)
    scrollToContentEnd(reducedMotionRef.current ? 'auto' : 'smooth')
  }, [scrollToContentEnd])

  const handleErrorRetry = useCallback(
    (messageId: string) => {
      instantExitIdsRef.current.add(messageId)
      for (const message of messages ?? []) {
        if (message.failed) instantExitIdsRef.current.add(message.id)
      }
      retryAtRef.current = performance.now()
      dismissErrorCard(messageId)
      retryLastUserMessage()
    },
    [retryLastUserMessage, dismissErrorCard, messages]
  )

  const showTypingPlaceholder = useMemo(() => {
    if (!isStreaming) return false
    const last = displayableMessages[displayableMessages.length - 1]
    if (!last) return false
    return last.messageType === 'prompt' && !!last.isPromptResponded
  }, [isStreaming, displayableMessages])

  return {
    isAuthenticated,
    onSignIn,
    currentConversation,
    isStreaming,
    currentUserMessageId,
    isRecoveryPending,
    revealingId,
    turnLive,
    turns,
    failedTurnIdsRef,
    activeProjectId,
    dismissErrorCard,
    t,
    tCollaboration,
    currentUserId,
    showReasoningSkills,
    shared,
    myRole,
    accessLost,
    turnInFlight,
    typists,
    lastArrival,
    participants,
    engagement,
    engagementSuggestion,
    setEngagement,
    authorOf,
    spectatedTurn,
    spectatingLive,
    turnInFlightLabel,
    scrollContainerRef,
    contentRef,
    showScrollButton,
    anchorSpacerRef,
    prefersReducedMotion,
    rowEnter,
    rowLeave,
    rowVariants,
    messages,
    commissionRun,
    commissionFromFinding,
    continueRun,
    displayableMessages,
    isEmpty,
    showSkeleton,
    listArrivesFromSkeleton,
    connectionNote,
    highlightedMessageId,
    authorship,
    unreadDividerBeforeId,
    awaiting,
    release,
    threadAwaitsHuman,
    setHandbackDismissedFor,
    handback,
    showHandback,
    handleHandback,
    handleAskAgent,
    handleAskBack,
    hydratedRailIdsRef,
    liveShownIdsRef,
    hydratedIds,
    threadLayout,
    getStepsForUserMessage,
    answerHasBegun,
    renderedIdsRef,
    heldAnswerId,
    turnNote,
    handleScroll,
    anchorId,
    handleScrollToLatest,
    handleErrorRetry,
    showTypingPlaceholder,
  }
}

export type ChatAreaController = ReturnType<typeof useChatAreaController>

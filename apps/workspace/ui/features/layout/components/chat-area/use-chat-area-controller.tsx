import { useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '@/features/chat/store'

import type { ChatMessage } from '@/features/chat/types'
import { useAnswerRevealStore } from '@/features/chat/stores/answer-reveal-store'
import type { Finding } from '@/lib/conversations/message-findings'
import { useCommissionRun } from '@/features/runs/hooks/use-commission-run'
import { continuationBrief, findingBrief } from '@/features/runs/lib/carry-forward'
import { useMessageAnchor } from '@/features/collaboration/hooks/use-message-anchor'
import { useSharedThread } from '@/features/collaboration/hooks/use-shared-thread'
import { useSpectatedTurn } from '@/features/collaboration/hooks/use-spectated-turn'
import { useAwaitingState } from '@/features/collaboration/hooks/use-sharing'
import { motionEntrance, motionInstant, motionQuickExit } from '@/components/motion'
import type { Variants } from 'motion/react'
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
import { ROW_GAP_PX } from './chat-area-helpers'
import { useThreadScrollState, useThreadFollow } from '../../hooks/use-thread-scroll'
import { useThreadAnchor } from '../../hooks/use-thread-anchor'
import { useHandback } from '../../hooks/use-handback'
import { useTurnStatus } from '../../hooks/use-turn-status'
import { useMessageAuthorship } from '../../hooks/use-message-authorship'
import { useConnectionNote } from '../../hooks/use-connection-note'

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

  const scroll = useThreadScrollState()
  const {
    scrollContainerRef,
    contentRef,
    anchorSpacerRef,
    followRef,
    jumpedRef,
    glideRef,
    retryAtRef,
    deepLinkedConversationRef,
    showScrollButton,
  } = scroll
  const instantExitIdsRef = useRef(new Set<string>())
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

  const connectionNote = useConnectionNote(currentConversation?.id, connectionLost)

  const anchoredMessageIds = useMemo(
    () => displayableMessages.map((m) => m.id),
    [displayableMessages]
  )
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

  const authorship = useMessageAuthorship({ shared, displayableMessages, authorOf, currentUserId })

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

  const {
    handback,
    showHandback,
    handleHandback,
    handleAskAgent,
    handleAskBack,
    setHandbackDismissedFor,
  } = useHandback({
    shared,
    authorOf,
    currentUserId,
    threadAwaitsHuman,
    displayableMessages,
    tCollaboration,
  })

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

  const {
    getStepsForUserMessage,
    answerHasBegun,
    heldAnswerId,
    renderedIdsRef,
    turnNote,
  } = useTurnStatus({
    displayableMessages,
    currentConversation,
    currentUserMessageId,
    turns,
    turnLive,
    hydratedIds,
    prefersReducedMotion,
    failedTurnIdsRef,
    t,
  })

  const stepsPhaseRef = useRef(false)
  stepsPhaseRef.current = turnLive && !answerHasBegun
  const turnLiveRef = useRef(turnLive)
  turnLiveRef.current = turnLive

  const { handleScroll, handleScrollToLatest, fitAnchorSpacer } = useThreadFollow(scroll, {
    activeConversationId: currentConversation?.id,
    listReady,
    isEmpty,
    isTargetPending,
    turnLiveRef,
    stepsPhaseRef,
    reducedMotionRef,
  })
  const { anchorId } = useThreadAnchor(scroll, {
    conversationId: currentConversation?.id,
    listReady,
    isEmpty,
    currentUserMessageId,
    lastQuestionId: threadLayout.lastQuestionId,
    unreadDividerBeforeId,
    isForeignTurn,
    spectatingLive,
    turnLiveRef,
    reducedMotionRef,
    isTargetPending,
    fitAnchorSpacer,
  })

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

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useShallow } from 'zustand/react/shallow'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useAuth } from '@/adapters/auth'
import { createTurnSocket, type OpenTurn } from '@/adapters/api/turn-socket'
import { browserPageLifecycle, isActive, sleptThrough } from '@/adapters/api/page-lifecycle'
import { watchRestoring } from '../connection-restoring'
import type { ClientMessage, ShownAnswer, WireEvent } from '@/adapters/api/wire-v2'
import { checkBackendHealthCached, invalidateHealthCache } from '@/shared/hooks/use-backend-health'
import { useThreadSharing } from '@/shared/collaboration/thread-sharing'
import type { AddresseeSet } from '@/lib/mentions/types'
import { useChatStore } from '../store'
import { mapServerMessagesToChatMessages } from '../lib/server-message-mapper'
import { isTransientConnectionError } from '@/features/layout/lib/thread-phase'
import { registerStopStreamingHandler, runningTurnIn } from '../stores/messages-store'
import { useConnectionRecovery } from './use-connection-recovery'
import { useEffortStore } from '../stores/effort-store'
import { capturePosthog } from '@/lib/analytics/posthog'
import type { ChatEffort } from '@/lib/reasoning-settings/catalog'
import { useLayoutStore } from '@/features/layout/store'
import { useDocumentsStore } from '@/features/documents/store'
import { getPosthogSessionId } from '@/lib/analytics/posthog'
import { fetchRunMessage } from '../lib/commissioned-run'
import { afterTemporarySettled } from '../lib/temporary-conversation'
import {
  clampFocusRegion,
  openCanvasFocus,
  registerCanvasChatSender,
  registerCanvasChatSteerer,
  type CanvasFocus,
  type CanvasFocusRegion,
} from '../lib/canvas-bridge'
import { STAGE_COUNT } from '../lib/turn-projection'
import { runErrorCard, type RunErrorCard } from '../lib/run-error'
import { isSteerRead, type TurnView } from '@/lib/turns/turn-fold'
import {
  dropViewerActions,
  newViewerActions,
  proposeViewerAction,
  releaseViewerActions,
  viewerClientTools,
} from '../lib/viewer-actions'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import type { ChatMessage, Conversation, PendingInteraction } from '../types'

export interface SendMessageMention {
  targetId: string
  display: string
}

export interface SendMessageOptions {
  mentions?: readonly SendMessageMention[]
  mentionNote?: string | null
  awaitingHuman?: boolean
  reasoningEffort?: ChatEffort
  canvas?: CanvasFocus
}

export interface SendMessageFailure {
  reason: string | null
  message: string | null
  targetId?: string | null
}

export interface SendMessageOutcome {
  ok: boolean
  addressees?: AddresseeSet
  failure?: SendMessageFailure
}

async function readSendFailure(response: Response): Promise<SendMessageFailure> {
  try {
    const body = (await response.json()) as {
      error?: string
      details?: { reason?: string; targetId?: string } | null
    }
    return {
      reason: body.details?.reason ?? null,
      message: body.error ?? null,
      targetId: body.details?.targetId ?? null,
    }
  } catch {
    return { reason: null, message: null }
  }
}

function readAddresseeRuling(body: unknown, messageId: string): AddresseeSet | null {
  const rows = (Array.isArray(body) ? body : [body]) as Array<{
    id?: string
    addressees?: AddresseeSet
  } | null>
  const row = rows.find((entry) => entry?.id === messageId) ?? null
  const addressees = row?.addressees
  if (!addressees || typeof addressees.agent !== 'boolean' || !Array.isArray(addressees.users)) {
    return null
  }
  return addressees
}

function appendLocalUserMessage(message: ChatMessage): void {
  const store = useChatStore as unknown as {
    getState: () => { currentConversation: Conversation | null; conversations: Conversation[] }
    setState?: (
      partial: Partial<{ currentConversation: Conversation | null; conversations: Conversation[] }>
    ) => void
  }
  const { currentConversation, conversations } = store.getState()
  if (!currentConversation || typeof store.setState !== 'function') return

  const updated: Conversation = {
    ...currentConversation,
    title: currentConversation.title || message.content.trim().slice(0, 50),
    messages: [...currentConversation.messages, message],
    updatedAt: new Date(),
  }
  store.setState({
    currentConversation: updated,
    conversations: conversations.map((conversation) =>
      conversation.id === updated.id ? updated : conversation
    ),
  })
}

export const DELTA_FLUSH_MS = 100

const STAGE_WIRE_TTL_MS = 10 * 60_000

const MAX_CONSECUTIVE_AUTH_EXPIRED = 3

const MAX_WAITING = 8

export const ACK_TIMEOUT_MS = 15_000

const ACK_MISSES_BEFORE_GIVING_UP = 2

const SILENT_DROPS_BEFORE_GIVING_UP = 2

type Rejection = Extract<WireEvent, { type: 'CUSTOM'; name: 'rejected' }>
type UserMessage = Extract<ClientMessage, { message_id: string }>

interface DriverHooks {
  refreshAuth: () => Promise<void>
  onConnected: (connected: boolean, steerOffered: boolean) => void
  onGaveUp: () => Promise<'network' | 'other'>
  onOffline: () => void
  onQueueFull: (text: string, retryAfterSeconds: number | null) => void
}

export interface TurnDriver {
  conversationId: string
  projectId: string | undefined
  connect: () => Promise<void>
  close: () => void
  ask: (message: UserMessage) => void
  deliver: (message: ClientMessage) => void
  cancel: (turnId: string, shown?: ShownAnswer) => void
  steer: (turnId: string, text: string, options?: SteerOptions) => boolean
}

export interface SteerOptions {
  focusRegion?: CanvasFocusRegion | null
  onLeftover?: (text: string) => void
}

interface SentSteer {
  turnId: string
  text: string
  onLeftover?: (text: string) => void
}

const store = () => useChatStore.getState()

const openVersionState = (state: DocumentVersionState | null | undefined): UserMessage['focus_version_state'] =>
  state === 'draft' || state === 'in_review' || state === 'changes_requested' ? state : null

const ending = new Set<string>()

const partialAnswerOf = (view: TurnView): ChatMessage | undefined => {
  if (!view.messageId) return undefined
  const { currentConversation, conversations } = store()
  const owner =
    currentConversation?.id === view.conversationId
      ? currentConversation
      : conversations.find((conversation) => conversation.id === view.conversationId)
  return owner?.messages.find(
    (message) => message.id === view.messageId && message.isStreaming && message.content.trim().length > 0
  )
}

const storedAnswerOf = async (view: TurnView): Promise<ChatMessage | null | undefined> => {
  if (!view.messageId) return null
  try {
    const { conversationsClient } = await import('@/adapters/api/conversations-client')
    const rows = await conversationsClient.listMessages(view.conversationId)
    const answer = mapServerMessagesToChatMessages(rows).find(
      (message) => message.id === view.messageId && message.role === 'assistant'
    )
    return answer ?? null
  } catch {
    return undefined
  }
}

const isNewestQuestion = (view: TurnView): boolean => {
  const conversation = store().currentConversation
  if (conversation?.id !== view.conversationId) return false
  return conversation.messages.findLast((message) => message.messageType === 'user')?.id === view.turnId
}

const awaitLostTurn = (view: TurnView, partial?: ChatMessage): void => {
  store().dropTurn(view.turnId)
  void store()
    ._awaitServerAnswer(view.conversationId, view.turnId)
    .then((outcome) => {
      if (outcome !== 'nothing' || store().currentConversation?.id !== view.conversationId) return
      if (partial && isNewestQuestion(view)) {
        store().adoptRunMessage(view.conversationId, { ...partial, isStreaming: undefined, failed: true })
      }
      store().addErrorCard('agent.response_interrupted')
    })
    .finally(() => ending.delete(view.turnId))
}

const endInterruptedTurn = (view: TurnView): void => {
  if (ending.has(view.turnId)) return
  ending.add(view.turnId)
  const partial = partialAnswerOf(view)
  if (!partial) return awaitLostTurn(view)
  void storedAnswerOf(view).then((answer) => {
    const now = store().turns[view.turnId]
    if (!now || now.lastSeq !== view.lastSeq || now.phase !== 'running' || answer === undefined) {
      ending.delete(view.turnId)
      return
    }
    if (!answer) return awaitLostTurn(view, partial)
    store().adoptRunMessage(view.conversationId, answer)
    store().dropTurn(view.turnId)
    ending.delete(view.turnId)
  })
}

const endFailedTurn = (view: TurnView, card: RunErrorCard = runErrorCard(view.error)): void => {
  store().failTurn(view.turnId)
  void store()
    ._recoverInterruptedAssistantMessage(view.conversationId, view.turnId)
    .then((outcome) => {
      if (outcome !== 'nothing' || store().currentConversation?.id !== view.conversationId) return
      store().addErrorCard(card.code, card.message, card.details)
    })
}

const createTurnDriver = (conversationId: string, projectId: string | undefined, hooks: DriverHooks): TurnDriver => {
  const unacknowledged = new Map<string, ClientMessage>()
  const ackDeadlines = new Map<string, ReturnType<typeof setTimeout>>()
  const ackMisses = new Map<string, number>()
  const silentDrops = new Map<string, number>()
  const sent = new Map<string, ClientMessage>()
  const waiting: ClientMessage[] = []
  const finishedAt = new Map<string, number>()
  const gapsAttached = new Map<string, number>()
  let buffer: WireEvent[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let authExpired = 0
  let socketOpen = false
  const steers = new Map<string, SentSteer>()
  const asked = new Set<string>()

  const keyOf = (message: ClientMessage): string =>
    `${message.type}:${'turn_id' in message ? message.turn_id : message.message_id}`

  const lifecycle = browserPageLifecycle()

  const openTurns = (): OpenTurn[] => {
    const now = Date.now()
    return Object.values(store().turns).flatMap((view): OpenTurn[] => {
      if (view.conversationId !== conversationId || unacknowledged.has(view.turnId)) return []
      if (ending.has(view.turnId)) return []
      if (view.phase === 'running') return [{ turnId: view.turnId, lastSeq: view.lastSeq }]
      const finished = finishedAt.get(view.turnId)
      const stagesPending =
        view.phase === 'finished' &&
        view.outcome !== 'cancelled' &&
        finished !== undefined &&
        now - finished < STAGE_WIRE_TTL_MS &&
        Object.keys(view.stages).length < STAGE_COUNT
      return stagesPending ? [{ turnId: view.turnId, lastSeq: view.lastSeq, settled: true }] : []
    })
  }

  const forget = (turnId: string): void => {
    unacknowledged.delete(turnId)
    clearTimeout(ackDeadlines.get(turnId))
    ackDeadlines.delete(turnId)
    ackMisses.delete(turnId)
  }

  const awaitAck = (turnId: string): void => {
    clearTimeout(ackDeadlines.get(turnId))
    const armedAt = Date.now()
    ackDeadlines.set(turnId, setTimeout(() => missedAck(turnId, armedAt), ACK_TIMEOUT_MS))
  }

  function missedAck(turnId: string, armedAt: number): void {
    ackDeadlines.delete(turnId)
    if (!unacknowledged.has(turnId)) return
    if (!isActive(lifecycle) || sleptThrough(armedAt, ACK_TIMEOUT_MS)) return awaitAck(turnId)
    const misses = (ackMisses.get(turnId) ?? 0) + 1
    if (misses >= ACK_MISSES_BEFORE_GIVING_UP) {
      forget(turnId)
      const view = store().turns[turnId]
      if (view?.phase === 'running') endFailedTurn(view, { code: 'agent.no_response' })
      return
    }
    ackMisses.set(turnId, misses)
    if (socketOpen) socket.reconnect()
    awaitAck(turnId)
  }

  const silent = (turnIds: readonly string[]): void => {
    flush()
    for (const turnId of turnIds) {
      const drops = (silentDrops.get(turnId) ?? 0) + 1
      silentDrops.set(turnId, drops)
      const view = store().turns[turnId]
      if (drops < SILENT_DROPS_BEFORE_GIVING_UP || view?.phase !== 'running') continue
      silentDrops.delete(turnId)
      endInterruptedTurn(view)
    }
  }

  const socket = createTurnSocket({
    conversationId,
    projectId,
    openTurns,
    refreshAuth: hooks.refreshAuth,
    onEvent: (event) => receive(event),
    onSilent: silent,
    onStatus: watchRestoring(conversationId, (status) => {
      socketOpen = status === 'open'
      hooks.onConnected(socketOpen, socketOpen && socket.accepts('steer'))
      if (status === 'open') opened()
      else if (status === 'offline') hooks.onOffline()
      else if (status === 'failed' || status === 'incompatible' || status === 'outdated') gaveUp(status)
    }),
  })

  const deliver = (message: ClientMessage): void => {
    if (message.type !== 'user_message' || message.context_only) sent.set(keyOf(message), message)
    if (socket.send(message)) return
    waiting.push(message)
    if (waiting.length > MAX_WAITING) waiting.shift()
  }

  const opened = (): void => {
    invalidateHealthCache()
    store().dismissConnectionErrors()
    for (const message of unacknowledged.values()) socket.send(message)
    for (const message of waiting.splice(0)) deliver(message)
  }

  const runningTurns = (): TurnView[] =>
    Object.values(store().turns).filter((view) => view.conversationId === conversationId && view.phase === 'running')

  const endEverything = (): void => {
    flush()
    for (const turnId of [...unacknowledged.keys()]) forget(turnId)
    waiting.length = 0
    for (const view of runningTurns()) endInterruptedTurn(view)
  }

  const gaveUp = (status: 'failed' | 'incompatible' | 'outdated'): void => {
    if (status === 'outdated') store().addErrorCard('connection.client_outdated')
    else if (status === 'incompatible') store().addErrorCard('connection.server_incompatible')
    if (status !== 'failed') return endEverything()
    void hooks.onGaveUp().then((cause) => {
      if (cause === 'other' && !socketOpen) endEverything()
    })
  }

  const settleSteers = (view: TurnView): void => {
    for (const [steerId, note] of [...steers]) {
      if (note.turnId !== view.turnId) continue
      steers.delete(steerId)
      if (isSteerRead(view, steerId) || view.outcome === 'cancelled') continue
      const leftover = note.onLeftover
      if (leftover) setTimeout(() => leftover(note.text), 0)
    }
  }

  const react = (previous: TurnView | undefined, view: TurnView | undefined): void => {
    if (!view) return
    if (asked.has(view.turnId) && view.messageId) {
      for (const call of newViewerActions(previous?.viewerActions, view.viewerActions)) {
        proposeViewerAction(view.messageId, call)
      }
      const ended = view.phase !== 'running' && (previous === undefined || previous.phase === 'running')
      if (ended && view.phase === 'finished' && view.outcome === 'answered' && view.text) {
        void releaseViewerActions(view.messageId)
      } else if (ended) {
        dropViewerActions(view.messageId)
      }
    }
    if (view.phase !== 'running' && previous?.phase === 'running') settleSteers(view)
    if (view.gap && gapsAttached.get(view.turnId) !== view.lastSeq) {
      gapsAttached.set(view.turnId, view.lastSeq)
      socket.send({ type: 'attach', conversation_id: conversationId, turn_id: view.turnId, after_seq: view.lastSeq })
    }
    if (view.phase === 'failed' && previous?.phase !== 'failed') endFailedTurn(view)
    const result = view.result
    if (!result || result === previous?.result) return
    if (result.job_admission_rejected) hooks.onQueueFull(result.text, result.retry_after_seconds)
    const run = result.run
    if (run) {
      void fetchRunMessage(conversationId, run.run_message_id).then((message) => {
        if (message) store().adoptRunMessage(conversationId, message)
      })
    }
  }

  const flush = (): void => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    const events = buffer
    buffer = []
    if (events.length === 0) return
    const before = store().turns
    store().applyTurnEvents(events)
    const after = store().turns
    for (const turnId of new Set(events.map((event) => event.turn_id))) react(before[turnId], after[turnId])
  }

  const lost = (turnId: string): void => {
    flush()
    forget(turnId)
    const view = store().turns[turnId]
    if (view?.phase === 'running') endInterruptedTurn(view)
    else if (view) store().dropTurn(turnId)
  }

  const rejected = ({ turn_id: turnId, value }: Rejection): void => {
    const view = store().turns[turnId]
    if (value.of === 'steer' && value.code !== 'auth_expired') {
      if (view && view.phase !== 'running') settleSteers(view)
      return
    }
    switch (value.code) {
      case 'auth_expired': {
        authExpired += 1
        if (authExpired > MAX_CONSECUTIVE_AUTH_EXPIRED) {
          authExpired = 0
          store().addErrorCard('auth.session_expired')
          forget(turnId)
          if (view?.phase === 'running') store().failTurn(turnId)
          return
        }
        const refused = sent.get(`${value.of}:${turnId}`)
        if (refused) waiting.push(refused)
        socket.close()
        void socket.connect()
        return
      }
      case 'duplicate_turn':
        forget(turnId)
        socket.send({ type: 'attach', conversation_id: conversationId, turn_id: turnId, after_seq: view?.lastSeq ?? 0 })
        return
      case 'turn_not_found':
        if (value.of === 'cancel_turn') store().keepStoppedAnswer(turnId)
        return lost(turnId)
      case 'conversation_mismatch':
      case 'invalid_message':
        if (value.of === 'attach' || value.of === 'cancel_turn') return lost(turnId)
        if (value.of !== 'user_message') return
        forget(turnId)
        store().dropTurn(turnId)
        store().addErrorCard('agent.response_failed', value.message ?? undefined)
        return
      case 'not_asker':
      case 'no_pending_interaction':
        return
    }
  }

  function receive(event: WireEvent): void {
    if (unacknowledged.has(event.turn_id)) {
      ackMisses.delete(event.turn_id)
      awaitAck(event.turn_id)
    }
    if (event.type === 'CUSTOM' && event.name === 'rejected') return rejected(event)
    silentDrops.delete(event.turn_id)
    if (event.type === 'RUN_STARTED') {
      forget(event.turn_id)
      authExpired = 0
    }
    if (event.type === 'RUN_FINISHED') finishedAt.set(event.turn_id, Date.now())
    buffer.push(event)
    if (event.type !== 'TEXT_MESSAGE_CONTENT') flush()
    else flushTimer ??= setTimeout(flush, DELTA_FLUSH_MS)
  }

  return {
    conversationId,
    projectId,
    connect: socket.connect,
    close: () => {
      flush()
      for (const turnId of [...unacknowledged.keys()]) forget(turnId)
      socket.close()
    },
    ask: (message) => {
      asked.add(message.message_id)
      unacknowledged.set(message.message_id, message)
      awaitAck(message.message_id)
      if (!socket.send(message)) void socket.connect()
    },
    deliver,
    cancel: (turnId, shown) => {
      flush()
      forget(turnId)
      deliver({ type: 'cancel_turn', conversation_id: conversationId, turn_id: turnId, ...(shown && { shown }) })
    },
    steer: (turnId, text, options) => {
      if (!socket.accepts('steer')) return false
      const steerId = uuidv4()
      const message: ClientMessage = {
        type: 'steer',
        conversation_id: conversationId,
        turn_id: turnId,
        steer_id: steerId,
        text,
        ...(options?.focusRegion ? { focus_region: clampFocusRegion(options.focusRegion) } : {}),
      }
      steers.set(steerId, { turnId, text, onLeftover: options?.onLeftover })
      sent.set(keyOf(message), message)
      socket.send(message)
      return true
    },
  }
}

const MEANINGFUL_MESSAGE_TYPES = new Set(['user', 'assistant', 'agent_response', 'error', 'prompt'])

interface UseWebSocketChatOptions {
  autoConnect?: boolean
  canCollaborate?: boolean
}

export interface SteerRequest {
  text: string
  focusRegion?: CanvasFocusRegion | null
  onLeftover?: (text: string) => void
}

interface UseWebSocketChatReturn {
  sendMessage: (content: string, options?: SendMessageOptions) => boolean | Promise<SendMessageOutcome>
  respondToInteraction: (response: string) => void
  noteSendIntent: () => void
  isLoading: boolean
  pendingInteraction: PendingInteraction | null
  steer: (request: SteerRequest) => boolean
  canSteer: boolean
}

const discoverBudgetFailureMessage = async (t: ReturnType<typeof useTranslations>): Promise<string | null> => {
  try {
    const activeProjectId = useChatStore.getState().projectId
    const query = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : ''
    const res = await fetch(`/api/auth/connection-diagnostics${query}`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { budgetExhausted?: boolean; canManageBudgets?: boolean }
    if (!body.budgetExhausted) return null
    return body.canManageBudgets ? t('budgetExhausted.adminMessage') : t('budgetExhausted.memberMessage')
  } catch {
    return null
  }
}

const ownsUnansweredTurnIn = (
  messages: ChatMessage[] | undefined,
  currentUserId: string | null
): boolean => {
  if (!messages?.length) return false
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!MEANINGFUL_MESSAGE_TYPES.has(message.messageType ?? '')) continue
    if (message.messageType === 'prompt') return !message.isPromptResponded
    if (message.messageType === 'user') {
      return !message.authorUserId || message.authorUserId === currentUserId
    }
    return message.isStreaming === true
  }
  return false
}

export const useWebSocketChat = (options: UseWebSocketChatOptions = {}): UseWebSocketChatReturn => {
  const { autoConnect = true, canCollaborate = false } = options
  const { user, authRequired, isLoading: authLoading, getAccessToken } = useAuth()
  const tChat = useTranslations(chatCopy)

  const { currentConversationId, ownsUnansweredTurn, isLoading, pendingInteraction, resumableTurn } =
    useChatStore(
      useShallow((s) => ({
        currentConversationId: s.currentConversation?.id,
        ownsUnansweredTurn: ownsUnansweredTurnIn(s.currentConversation?.messages, s.currentUserId),
        isLoading: s.isLoading,
        pendingInteraction: s.pendingInteraction,
        resumableTurn: s.resumableTurn,
      }))
    )
  const projectId = useChatStore((s) => s.projectId) || undefined
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const addErrorCard = useChatStore((s) => s.addErrorCard)
  const respondToPrompt = useChatStore((s) => s.respondToPrompt)
  const setCurrentUser = useChatStore((s) => s.setCurrentUser)

  useEffect(() => {
    setCurrentUser(user?.id ?? null)
  }, [user?.id, setCurrentUser])

  const threadSharing = useThreadSharing(currentConversationId)

  const socketGateRef = useRef<{
    conversationId: string | undefined
    intent: boolean
    open: boolean
  }>({ conversationId: undefined, intent: false, open: false })

  const [, bumpSocketGate] = useState(0)

  if (socketGateRef.current.conversationId !== currentConversationId) {
    socketGateRef.current = { conversationId: currentConversationId, intent: false, open: false }
  }

  const noteSendIntent = useCallback(() => {
    if (socketGateRef.current.intent) return
    socketGateRef.current.intent = true
    bumpSocketGate((n) => n + 1)
  }, [])

  if (
    !canCollaborate ||
    threadSharing === 'private' ||
    socketGateRef.current.intent ||
    ownsUnansweredTurn
  ) {
    socketGateRef.current.open = true
  }
  const socketPermitted = socketGateRef.current.open

  const driverRef = useRef<TurnDriver | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [steerOffered, setSteerOffered] = useState(false)

  const isSessionExpired = authRequired && !user && !authLoading
  const hooks: DriverHooks = {
    refreshAuth: async () => {
      if (!authRequired || !getAccessToken) return
      await getAccessToken()
    },
    onConnected: (connected, offered) => {
      setIsConnected(connected)
      setSteerOffered(offered)
    },
    onGaveUp: () => explainConnectionFailure(),
    onOffline: () => {
      if (useChatStore.getState().currentConversation?.messages.some(isTransientConnectionError)) return
      addErrorCard('connection.lost')
    },
    onQueueFull: (text, retryAfter) => {
      const message = retryAfter
        ? `${tChat('errorRegistry.researchQueueFull.full')} ${tChat('errorRegistry.researchQueueFull.retryHint', { seconds: retryAfter })}`
        : tChat('errorRegistry.researchQueueFull.message')
      addErrorCard('research.queue_full', message, text.trim() || undefined)
    },
  }
  const hooksRef = useRef(hooks)
  useEffect(() => {
    hooksRef.current = hooks
  })

  const budgetCheckedRef = useRef(false)
  const explainConnectionFailure = async (): Promise<'network' | 'other'> => {
    const conversationId = useChatStore.getState().currentConversation?.id
    const stillHere = () => useChatStore.getState().currentConversation?.id === conversationId
    if (!budgetCheckedRef.current) {
      budgetCheckedRef.current = true
      const budgetMessage = await discoverBudgetFailureMessage(tChat)
      if (!stillHere()) return 'network'
      if (budgetMessage) {
        addErrorCard('budget.exhausted', budgetMessage)
        return 'other'
      }
    }
    const backendUp = await checkBackendHealthCached()
    if (!stillHere()) return 'network'
    const expired = backendUp && isSessionExpired
    addErrorCard(expired ? 'auth.session_expired' : 'connection.failed')
    return expired ? 'other' : 'network'
  }

  const ensureDriver = useCallback((conversationId: string): TurnDriver => {
    const projectId = useChatStore.getState().projectId || undefined
    const current = driverRef.current
    if (current?.conversationId === conversationId && current.projectId === projectId) return current
    current?.close()
    budgetCheckedRef.current = false
    const driver = createTurnDriver(conversationId, projectId, {
      refreshAuth: () => hooksRef.current.refreshAuth(),
      onConnected: (connected, offered) => hooksRef.current.onConnected(connected, offered),
      onGaveUp: () => hooksRef.current.onGaveUp(),
      onOffline: () => hooksRef.current.onOffline(),
      onQueueFull: (text, retryAfter) => hooksRef.current.onQueueFull(text, retryAfter),
    })
    driverRef.current = driver
    void driver.connect()
    return driver
  }, [])

  useEffect(() => {
    if (currentConversationId && autoConnect && socketPermitted) ensureDriver(currentConversationId)
    const driver = driverRef.current
    if (driver && driver.conversationId !== currentConversationId) {
      driver.close()
      driverRef.current = null
      setIsConnected(false)
      setSteerOffered(false)
    }
  }, [currentConversationId, projectId, autoConnect, socketPermitted, ensureDriver])
  useEffect(
    () => () => {
      driverRef.current?.close()
      driverRef.current = null
    },
    []
  )

  useEffect(() => {
    const driver = driverRef.current
    if (!resumableTurn || !isConnected || driver?.conversationId !== resumableTurn.conversationId) return
    const { turns, beginTurn } = useChatStore.getState()
    if (runningTurnIn(turns, resumableTurn.conversationId)) return
    beginTurn(resumableTurn.conversationId, resumableTurn.turnId)
    driver.deliver({
      type: 'attach',
      conversation_id: resumableTurn.conversationId,
      turn_id: resumableTurn.turnId,
      after_seq: 0,
    })
  }, [resumableTurn, isConnected])

  useEffect(() => {
    registerStopStreamingHandler((turnId, shown) => {
      const conversationId = useChatStore.getState().currentConversation?.id
      if (conversationId) ensureDriver(conversationId).cancel(turnId, shown)
    })
    return () => registerStopStreamingHandler(null)
  }, [ensureDriver])

  const connect = useCallback(() => {
    const conversationId = useChatStore.getState().currentConversation?.id
    if (!conversationId) return
    if (driverRef.current?.conversationId === conversationId) void driverRef.current.connect()
    else ensureDriver(conversationId)
  }, [ensureDriver])
  useConnectionRecovery(connect)

  const deliverAsContext = useCallback(
    (messageId: string, content: string, dataSourcesForMessage: string[] | null): void => {
      const conversationId = useChatStore.getState().currentConversation?.id
      if (!conversationId) return
      noteSendIntent()
      ensureDriver(conversationId).deliver({
        type: 'user_message',
        conversation_id: conversationId,
        message_id: messageId,
        text: content,
        data_sources: dataSourcesForMessage,
        context_only: true,
        author_name: user?.name ?? user?.email ?? null,
      })
    },
    [user?.name, user?.email, ensureDriver, noteSendIntent]
  )

  const collectSendMetadata = useCallback(() => {
    const layoutState = useLayoutStore.getState()
    const enabledDataSources = layoutState.enabledDataSourceIds

    const sessionId = useChatStore.getState().currentConversation?.id
    const trackedFiles = useDocumentsStore.getState().trackedFiles
    const sessionFiles = sessionId
      ? trackedFiles.filter(
          (f) =>
            f.collectionName === sessionId && (f.status === 'ingesting' || f.status === 'success')
        )
      : []

    const dataSourcesForMessage = layoutState.knowledgeLayerAvailable
      ? Array.from(new Set([...enabledDataSources, 'knowledge_layer']))
      : enabledDataSources
    return {
      dataSourcesForMessage,
      dataSourcesOnWire:
        layoutState.availableDataSources === null && dataSourcesForMessage.length === 0 ? null : dataSourcesForMessage,
      messageFiles: sessionFiles.map((f) => ({ id: f.id, fileName: f.fileName })),
    }
  }, [])

  const openAgentTurn = useCallback(
    (
      messageId: string,
      content: string,
      dataSourcesForMessage: string[] | null,
      conversationId: string | undefined,
      reasoningEffort?: ChatEffort,
      asked?: CanvasFocus
    ): boolean => {
      const canvas = asked ?? openCanvasFocus() ?? undefined
      if (!conversationId) {
        addErrorCard('system.unknown', 'No active conversation')
        return false
      }
      const subject = useChatStore.getState().composerSubject
      const subjectName = subject?.filename?.trim() || subject?.title?.trim() || undefined
      const effort = reasoningEffort ?? useEffortStore.getState().levelForSend(conversationId)
      const posthogSessionId = getPosthogSessionId()
      useChatStore.getState().beginTurn(conversationId, messageId, effort)
      capturePosthog('chat_message_sent', {
        has_attachments: collectSendMetadata().messageFiles.length > 0,
        effort,
        data_source_count: dataSourcesForMessage?.length ?? null,
      })
      const clientTools = viewerClientTools()
      const question: UserMessage & { focus_region?: CanvasFocusRegion | null; reply_in_thread?: boolean } = {
        type: 'user_message',
        conversation_id: conversationId,
        message_id: messageId,
        text: content,
        data_sources: dataSourcesForMessage,
        focus_file_name: canvas ? canvas.fileName : subjectName || null,
        focus_shelf: canvas ? canvas.shelf : (subject?.shelf ?? null),
        focus_document_id: canvas ? canvas.documentId : (subject?.resourceId ?? null),
        focus_version_id: canvas ? canvas.versionId : (subject?.versionId ?? null),
        focus_version_state: openVersionState(canvas ? canvas.versionState : subject?.versionState),
        ...(canvas ? { focus_region: canvas.region ? clampFocusRegion(canvas.region) : null } : {}),
        ...(canvas?.replyInThread ? { reply_in_thread: true } : {}),
        source_preset: useLayoutStore.getState().activeSourcePreset ?? null,
        reasoning_effort: effort,
        ...(posthogSessionId ? { posthog_session_id: posthogSessionId } : {}),
        ...(clientTools.length ? { client_tools: clientTools } : {}),
      }
      afterTemporarySettled(conversationId, () => ensureDriver(conversationId).ask(question))
      return true
    },
    [addErrorCard, collectSendMetadata, ensureDriver]
  )

  const sendRuledMessage = useCallback(
    async (content: string, options: SendMessageOptions): Promise<SendMessageOutcome> => {
      const mentions = options.mentions ?? []
      const store = useChatStore.getState()
      const conversationId = store.currentConversation?.id ?? store.ensureSession?.()
      if (!conversationId) {
        addErrorCard('system.unknown', 'No active conversation')
        return { ok: false }
      }

      const { dataSourcesForMessage, dataSourcesOnWire, messageFiles } = collectSendMetadata()
      const messageId = uuidv4()

      let ruling: AddresseeSet | null = null
      try {
        await store._ensureConversationExists?.()

        const response = await fetch(
          `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: messageId,
              role: 'user',
              content,
              messageType: 'user',
              metadata: {
                enabledDataSources: dataSourcesForMessage,
                ...(messageFiles.length > 0 ? { messageFiles } : {}),
              },
              createdAt: new Date().toISOString(),
              mentions: mentions.map((mention) => ({ targetId: mention.targetId })),
              ...(options.mentionNote ? { mentionNote: options.mentionNote } : {}),
            }),
          }
        )

        if (!response.ok) {
          return { ok: false, failure: await readSendFailure(response) }
        }
        ruling = readAddresseeRuling(await response.json(), messageId)
      } catch {
        return { ok: false, failure: { reason: null, message: null } }
      }

      if (!ruling) return { ok: false, failure: { reason: null, message: null } }

      appendLocalUserMessage({
        id: messageId,
        role: 'user',
        content,
        timestamp: new Date(),
        messageType: 'user',
        enabledDataSources: dataSourcesForMessage,
        messageFiles: messageFiles.length > 0 ? messageFiles : undefined,
        mentions: mentions.map((mention) => ({ ...mention })),
        addressees: ruling,
      })

      if (!ruling.agent) {
        deliverAsContext(messageId, content, dataSourcesOnWire)
        return { ok: true, addressees: ruling }
      }

      const started = openAgentTurn(messageId, content, dataSourcesOnWire, conversationId, options.reasoningEffort)
      return { ok: started, addressees: ruling }
    },
    [addErrorCard, collectSendMetadata, deliverAsContext, openAgentTurn]
  )

  const sendMessage = useCallback(
    (content: string, options?: SendMessageOptions): boolean | Promise<SendMessageOutcome> => {
      if (!content.trim()) return false
      if ((options?.mentions && options.mentions.length > 0) || options?.awaitingHuman) {
        return sendRuledMessage(content, options ?? {})
      }
      const { dataSourcesForMessage, dataSourcesOnWire, messageFiles } = collectSendMetadata()
      const message = addUserMessage(content, { enabledDataSources: dataSourcesForMessage, messageFiles })
      const conversationId = useChatStore.getState().currentConversation?.id
      return openAgentTurn(
        message.id,
        content,
        dataSourcesOnWire,
        conversationId,
        options?.reasoningEffort,
        options?.canvas
      )
    },
    [addUserMessage, collectSendMetadata, openAgentTurn, sendRuledMessage]
  )

  const steer = useCallback(
    ({ text, focusRegion, onLeftover }: SteerRequest): boolean => {
      const { currentConversation, turns } = useChatStore.getState()
      const running = runningTurnIn(turns, currentConversation?.id)
      const driver = driverRef.current
      if (!text.trim() || !running || driver?.conversationId !== running.conversationId) return false
      return driver.steer(running.turnId, text.trim(), {
        focusRegion,
        onLeftover: onLeftover ?? ((leftover) => void sendMessage(leftover)),
      })
    },
    [sendMessage]
  )

  useEffect(() => registerCanvasChatSteerer((request) => steer(request)), [steer])
  useEffect(
    () =>
      registerCanvasChatSender((question) => {
        const sent = sendMessage(question.text, { reasoningEffort: question.effort, canvas: question.focus })
        const { currentConversation, currentUserMessageId } = useChatStore.getState()
        if (sent !== true || !currentConversation || !currentUserMessageId) return null
        return { conversationId: currentConversation.id, turnId: currentUserMessageId }
      }),
    [sendMessage]
  )

  const respondToInteraction = useCallback(
    (response: string) => {
      const { pendingInteraction: pending, currentConversation } = useChatStore.getState()
      if (!pending || !currentConversation) return
      const prompt = currentConversation.messages.findLast(
        (m) => m.messageType === 'prompt' && m.promptId === pending.interactionId
      )
      if (prompt) respondToPrompt(prompt.id, response)
      ensureDriver(currentConversation.id).deliver({
        type: 'interaction_response',
        conversation_id: currentConversation.id,
        turn_id: pending.turnId,
        interaction_id: pending.interactionId,
        answer: pending.input === 'choice' ? { option_id: response } : { text: response },
      })
    },
    [respondToPrompt, ensureDriver]
  )

  return {
    sendMessage,
    respondToInteraction,
    noteSendIntent,
    isLoading,
    pendingInteraction,
    steer,
    canSteer: isConnected && steerOffered,
  }
}

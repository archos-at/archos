'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useShallow } from 'zustand/react/shallow'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useAuth } from '@/adapters/auth'
import { checkBackendHealthCached } from '@/shared/hooks/use-backend-health'
import { useThreadSharing } from '@/shared/collaboration/thread-sharing'
import type { AddresseeSet } from '@/lib/mentions/types'
import { useChatStore } from '../store'
import { isTransientConnectionError } from '@/features/layout/lib/thread-phase'
import { registerStopStreamingHandler, runningTurnIn } from '../stores/messages-store'
import { useConnectionRecovery } from './use-connection-recovery'
import { useEffortStore } from '../stores/effort-store'
import { capturePosthog } from '@/lib/analytics/posthog'
import type { ChatEffort } from '@/lib/reasoning-settings/catalog'
import { useLayoutStore } from '@/features/layout/store'
import { useDocumentsStore } from '@/features/documents/store'
import { getPosthogSessionId } from '@/lib/analytics/posthog'
import { afterTemporarySettled } from '../lib/temporary-conversation'
import {
  clampFocusRegion,
  openCanvasFocus,
  registerCanvasChatSender,
  registerCanvasChatSteerer,
  type CanvasFocus,
  type CanvasFocusRegion,
} from '../lib/canvas-bridge'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import type { ChatMessage, Conversation, PendingInteraction } from '../types'
import { createTurnDriver, type DriverHooks, type TurnDriver, type UserMessage } from '../lib/turn-driver'
import {
  readAddresseeRuling,
  readSendFailure,
  type SendMessageOptions,
  type SendMessageOutcome,
} from '../lib/send-message-result'
import { discoverBudgetFailureMessage } from '../lib/budget-failure-message'
import { ownsUnansweredTurnIn } from '../lib/turn-ownership'
import { viewerClientTools } from '../lib/viewer-actions'

export type {
  SendMessageFailure,
  SendMessageMention,
  SendMessageOptions,
  SendMessageOutcome,
} from '../lib/send-message-result'
export { ACK_TIMEOUT_MS, DELTA_FLUSH_MS, type SteerOptions, type TurnDriver } from '../lib/turn-driver'

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

const openVersionState = (state: DocumentVersionState | null | undefined): UserMessage['focus_version_state'] =>
  state === 'draft' || state === 'in_review' || state === 'changes_requested' ? state : null

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

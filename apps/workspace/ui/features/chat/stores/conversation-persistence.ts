import type { StateCreator } from 'zustand'
import type { ChatMessage, ChatStore, Conversation } from '../types'
import type { SessionsSlice } from './sessions-store'
import type { CardInteractions } from '@/features/cards/card-decision'
import type { MessageStages } from '@/lib/conversations/message-stages'
import { encodeCitations } from '../lib/citations'
import { markConversationOnServer } from '../lib/conversation-on-server'
import { recordCreateFailed, recordCreateStarted, recordCreatedTemporary } from '../lib/temporary-created'
import { getConversationsClient, isRightsLost } from '../lib/conversations-client-access'

const ensuredServerConversations = new Map<string, Promise<void>>()

const ensureServerConversation = (
  conversation: Conversation,
  fallbackProjectId: string | null
): Promise<void> => {
  const inFlight = ensuredServerConversations.get(conversation.id)
  if (inFlight) return inFlight

  const promise = (async () => {
    const conversationsClient = await getConversationsClient()
    recordCreateStarted(conversation.id, conversation.temporary === true)
    const created = await conversationsClient.create(
      conversation.id,
      conversation.title || undefined,
      conversation.projectId ?? fallbackProjectId,
      conversation.subjectResourceId
        ? { resourceType: 'document', resourceId: conversation.subjectResourceId }
        : null,
      conversation.temporary
    )
    recordCreatedTemporary(conversation.id, created?.temporary === true)
    markConversationOnServer(conversation.id)
  })()

  const tracked = promise.catch((err) => {
    ensuredServerConversations.delete(conversation.id)
    recordCreateFailed(conversation.id)
    throw err
  })
  ensuredServerConversations.set(conversation.id, tracked)
  return tracked
}

const conversationOf = (
  { currentConversation, conversations }: Pick<ChatStore, 'currentConversation' | 'conversations'>,
  conversationId?: string
): Conversation | null => {
  if (conversationId === undefined || conversationId === currentConversation?.id) return currentConversation
  return conversations.find((conversation) => conversation.id === conversationId) ?? null
}

export const forgetServerConversation = (conversationId: string): void => {
  ensuredServerConversations.delete(conversationId)
}

export const createConversationPersistenceSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  Pick<
    SessionsSlice,
    | '_ensureConversationExists'
    | '_appendMessage'
    | '_persistPromptState'
    | '_persistStageOutput'
    | '_persistTurnProvenance'
    | '_cutStoppedAnswer'
    | '_persistCardInteractions'
  >
> = (_set, get) => ({
  _ensureConversationExists: async () => {
    const { currentConversation, projectId } = get()
    if (!currentConversation) return

    try {
      await ensureServerConversation(currentConversation, projectId ?? null)
    } catch (err) {
      console.warn('[ensureConversationExists] Failed:', err)
    }
  },

  _appendMessage: async (message: ChatMessage, conversationId?: string) => {
    const { projectId } = get()
    const currentConversation = conversationOf(get(), conversationId)
    if (!currentConversation) return

    try {
      const conversationsClient = await getConversationsClient()

      await ensureServerConversation(currentConversation, projectId ?? null)

      await conversationsClient.createMessage(currentConversation.id, {
        id: message.id,
        role: message.role,
        content: message.content,
        messageType: message.messageType,
        metadata: {
          ...(message.errorData && { errorData: message.errorData }),
          ...(message.fileData && { fileData: message.fileData }),
          ...(message.cards && { cards: message.cards }),
          ...(message.answerMeta && { answerMeta: message.answerMeta }),
          ...(message.stopped && { provenance: { stopped: true } }),
          ...(message.cardInteractions && { cardInteractions: message.cardInteractions }),
          ...(message.enabledDataSources && { enabledDataSources: message.enabledDataSources }),
          ...(message.messageFiles && { messageFiles: message.messageFiles }),
          ...(message.messageType === 'prompt'
            ? {
                prompt: {
                  ...(message.promptId && { promptId: message.promptId }),
                  ...(message.promptParentId && { promptParentId: message.promptParentId }),
                  ...(message.promptInputType && { promptInputType: message.promptInputType }),
                  ...(message.promptOptions && { promptOptions: message.promptOptions }),
                  ...(message.promptPlaceholder && {
                    promptPlaceholder: message.promptPlaceholder,
                  }),
                  ...(get().currentUserId ? { promptFor: get().currentUserId } : {}),
                },
              }
            : {}),
          ...(() => {
            const citations = encodeCitations(message.citations)
            return citations ? { citations } : {}
          })(),
          ...(() => {
            const readSources = encodeCitations(message.readSources)
            return readSources ? { readSources } : {}
          })(),
        },
        createdAt:
          message.timestamp instanceof Date
            ? message.timestamp.toISOString()
            : String(message.timestamp),
      })
    } catch (err) {
      if (isRightsLost(err)) get()._lockConversation(currentConversation.id)
      else console.warn('[appendMessage] Failed:', err)
    }
  },

  _persistPromptState: async (messageId: string, response: string) => {
    const { currentConversation } = get()
    if (!currentConversation) return
    try {
      const conversationsClient = await getConversationsClient()
      await conversationsClient.updateMessagePromptState(currentConversation.id, messageId, {
        response,
      })
    } catch (err) {
      console.warn('[persistPromptState] Failed:', err)
    }
  },

  _persistStageOutput: async (conversationId: string, messageId: string, stages: MessageStages) => {
    try {
      const conversationsClient = await getConversationsClient()
      await conversationsClient.updateMessageStages(conversationId, messageId, {
        ...stages,
      })
    } catch (err) {
      console.warn('[persistStageOutput] Failed:', err)
    }
  },

  _persistTurnProvenance: async (after?: Promise<unknown>, turn?: { conversationId: string; turnId: string }) => {
    const currentConversation = conversationOf(get(), turn?.conversationId)
    const currentUserMessageId = turn?.turnId ?? get().currentUserMessageId
    if (!currentConversation) return

    const messages = currentConversation.messages
    const userMessage = currentUserMessageId
      ? messages.find((message) => message.id === currentUserMessageId)
      : undefined
    const assistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')

    const targets: Array<[string, Record<string, unknown>]> = []

    if (userMessage?.thinkingSteps?.length) {
      targets.push([userMessage.id, { thinkingSteps: userMessage.thinkingSteps }])
    }

    if (assistantMessage) {
      const provenance: Record<string, unknown> = {}
      if (assistantMessage.answerConfidence) {
        provenance.answerConfidence = assistantMessage.answerConfidence
      }
      if (assistantMessage.answerConfidenceCappedReason) {
        provenance.answerConfidenceCappedReason = assistantMessage.answerConfidenceCappedReason
      }
      if (assistantMessage.answerConfidenceReason) {
        provenance.answerConfidenceReason = assistantMessage.answerConfidenceReason
      }
      if (assistantMessage.routingDecision) {
        provenance.routingDecision = assistantMessage.routingDecision
      }
      if (assistantMessage.escalationReason) {
        provenance.escalationReason = assistantMessage.escalationReason
      }
      if (assistantMessage.answerDurationMs) {
        provenance.answerDurationMs = assistantMessage.answerDurationMs
      }
      if (assistantMessage.reasoningEffort) {
        provenance.reasoningEffort = assistantMessage.reasoningEffort
      }
      if (assistantMessage.citationsRemoved) {
        provenance.citationsRemoved = assistantMessage.citationsRemoved
      }
      if (assistantMessage.skillsActivated?.length) {
        provenance.skillsActivated = assistantMessage.skillsActivated
      }
      if (assistantMessage.skillsHidden?.length) {
        provenance.skillsHidden = assistantMessage.skillsHidden
      }
      if (assistantMessage.researchTruncated) provenance.researchTruncated = true
      if (assistantMessage.stopped) provenance.stopped = true
      if (assistantMessage.truncationReason)
        provenance.truncationReason = assistantMessage.truncationReason
      if (assistantMessage.degradedReasons?.length)
        provenance.degradedReasons = assistantMessage.degradedReasons
      if (assistantMessage.deepResearchJobId) {
        provenance.deepResearchJobId = assistantMessage.deepResearchJobId
      }
      if (assistantMessage.retrievalLedger && assistantMessage.retrievalLedger.length > 0) {
        provenance.retrievalLedger = assistantMessage.retrievalLedger
      }
      if (assistantMessage.quoteStamps && assistantMessage.quoteStamps.length > 0) {
        provenance.quoteStamps = assistantMessage.quoteStamps
      }
      if (assistantMessage.confidenceCheck) provenance.confidenceCheck = assistantMessage.confidenceCheck
      if (assistantMessage.answerConfidenceVersion) {
        provenance.answerConfidenceVersion = assistantMessage.answerConfidenceVersion
      }
      if (assistantMessage.lookupFoundNothing) provenance.lookupFoundNothing = true

      if (Object.keys(provenance).length > 0) targets.push([assistantMessage.id, provenance])
    }

    if (targets.length === 0) return

    try {
      await after?.catch(() => undefined)
      const conversationsClient = await getConversationsClient()
      for (const [messageId, provenance] of targets) {
        await conversationsClient.updateMessageProvenance(
          currentConversation.id,
          messageId,
          provenance
        )
      }
    } catch (err) {
      console.warn('[persistTurnProvenance] Failed:', err)
    }
  },

  _cutStoppedAnswer: async (conversationId: string, messageId: string, turnId: string, shown: string) => {
    try {
      const conversationsClient = await getConversationsClient()
      await conversationsClient.cutStoppedAnswer(conversationId, messageId, { turnId, shown })
    } catch (err) {
      console.warn('[cutStoppedAnswer] Failed:', err)
    }
  },

  _persistCardInteractions: async (
    conversationId: string,
    messageId: string,
    cardInteractions: CardInteractions
  ) => {
    try {
      const conversationsClient = await getConversationsClient()
      await conversationsClient.updateMessageCardInteractions(
        conversationId,
        messageId,
        cardInteractions
      )
    } catch (err) {
      console.warn('[persistCardInteractions] Failed:', err)
    }
  },
})

import type { TurnView } from '@/lib/turns/turn-fold'
import { runErrorCard, type RunErrorCard } from './run-error'
import { mapServerMessagesToChatMessages } from './server-message-mapper'
import { useChatStore } from '../store'
import type { ChatMessage } from '../types'

const store = () => useChatStore.getState()

export const ending = new Set<string>()

const ownerOf = (view: TurnView) => {
  const { currentConversation, conversations } = store()
  return currentConversation?.id === view.conversationId
    ? currentConversation
    : conversations.find((conversation) => conversation.id === view.conversationId)
}

const partialAnswerOf = (view: TurnView): ChatMessage | undefined => {
  if (!view.messageId) return undefined
  return ownerOf(view)?.messages.find(
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

const isNewestQuestion = (view: TurnView): boolean =>
  ownerOf(view)?.messages.findLast((message) => message.messageType === 'user')?.id === view.turnId

const awaitLostTurn = (view: TurnView, partial?: ChatMessage): void => {
  store().dropTurn(view.turnId)
  void store()
    ._awaitServerAnswer(view.conversationId, view.turnId)
    .then((outcome) => {
      if (outcome !== 'nothing' || !ownerOf(view)) return
      if (partial && isNewestQuestion(view)) {
        store().adoptRunMessage(view.conversationId, { ...partial, isStreaming: undefined, failed: true })
      }
      store().addErrorCard('agent.response_interrupted', undefined, undefined, view.conversationId)
    })
    .finally(() => ending.delete(view.turnId))
}

export const endInterruptedTurn = (view: TurnView): void => {
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

export const endFailedTurn = (view: TurnView, card: RunErrorCard = runErrorCard(view.error)): void => {
  store().failTurn(view.turnId)
  void store()
    ._recoverInterruptedAssistantMessage(view.conversationId, view.turnId)
    .then((outcome) => {
      if (!ownerOf(view)) return
      if (outcome === 'nothing') return store().addErrorCard(card.code, card.message, card.details, view.conversationId)
      useChatStore.setState(({ unseenAnswers }) =>
        unseenAnswers[view.conversationId] === 'failed'
          ? { unseenAnswers: { ...unseenAnswers, [view.conversationId]: 'answered' } }
          : {}
      )
    })
}

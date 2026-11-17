'use client'

import { useCallback, useState } from 'react'
import { useChatStore } from '@/features/chat/store'
import type { ChatStore } from '@/features/chat/types'
import type { CardDecision } from '../card-decision'

export interface UseCardDecisionResult {
  decision: CardDecision | null
  decide: (decision: CardDecision) => void
  canDecide: boolean
}

export interface UseCardDecisionOptions {
  mustPersist?: boolean
}

const owningConversation = (
  state: Pick<ChatStore, 'currentConversation' | 'conversations'>,
  messageId: string
) =>
  state.currentConversation?.messages.some((m) => m.id === messageId)
    ? state.currentConversation
    : state.conversations.find((c) => c.messages.some((m) => m.id === messageId))

export const selectCardDecision = (
  state: Pick<ChatStore, 'currentConversation' | 'conversations'>,
  messageId: string | undefined,
  cardKey: string
): CardDecision | null => {
  if (!messageId) return null
  const conversation = owningConversation(state, messageId)
  return conversation?.messages.find((m) => m.id === messageId)?.cardInteractions?.[cardKey]?.decision ?? null
}

export const selectCardConversationId = (
  state: Pick<ChatStore, 'currentConversation' | 'conversations'>,
  messageId: string | undefined
): string | null => (messageId ? (owningConversation(state, messageId)?.id ?? null) : null)

export function useCardDecision(
  messageId: string | undefined,
  cardKey: string,
  options?: UseCardDecisionOptions
): UseCardDecisionResult {
  const canDecide = Boolean(messageId) || !options?.mustPersist
  const persisted = useChatStore((state) => selectCardDecision(state, messageId, cardKey))
  const setCardDecision = useChatStore((state) => state.setCardDecision)

  const [local, setLocal] = useState<CardDecision | null>(null)

  const decide = useCallback(
    (decision: CardDecision) => {
      if (!messageId) {
        if (!canDecide) return
        setLocal(decision)
        return
      }
      setCardDecision(messageId, cardKey, decision)
      if (selectCardDecision(useChatStore.getState(), messageId, cardKey) === null) {
        setLocal(decision)
      }
    },
    [messageId, cardKey, setCardDecision, canDecide]
  )

  return { decision: persisted ?? local, decide, canDecide }
}

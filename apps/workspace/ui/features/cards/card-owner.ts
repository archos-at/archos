import type { AnswerCard } from '@/shared/cards/schemas'

export interface CardOwnerMessage {
  id: string
  deepResearchJobId?: string
  cards?: readonly (AnswerCard | undefined)[]
}

export interface CardOwnerConversation {
  id: string
  messages: readonly CardOwnerMessage[]
}

export interface CardOwnerSource {
  currentConversation?: CardOwnerConversation | null
  conversations?: readonly CardOwnerConversation[]
}

export const findCardOwnerMessageId = (
  source: CardOwnerSource,
  jobId: string | null | undefined,
  cards: readonly (AnswerCard | undefined)[]
): string | null => {
  if (!jobId || cards.length === 0) return null

  const wanted = JSON.stringify(cards)
  const searched = new Set<string>()
  const candidates = [source.currentConversation, ...(source.conversations ?? [])]

  for (const conversation of candidates) {
    if (!conversation || searched.has(conversation.id)) continue
    searched.add(conversation.id)

    let owner: string | null = null
    for (const message of conversation.messages) {
      if (message.deepResearchJobId !== jobId) continue
      if (!message.cards || message.cards.length !== cards.length) continue
      if (JSON.stringify(message.cards) !== wanted) continue
      owner = message.id
    }
    if (owner) return owner
  }

  return null
}

import type { Conversation } from '../types'

const PROVISIONAL_TITLE_LENGTH = 50

export function provisionalTitle(text: string): string {
  const line = text.split('\n').map((part) => part.trim()).find((part) => part.length > 0) ?? ''
  const words = line.replace(/\s+/g, ' ')
  return words.length <= PROVISIONAL_TITLE_LENGTH ? words : `${words.slice(0, PROVISIONAL_TITLE_LENGTH).trimEnd()}…`
}

export function titledByFirstMessage(conversation: Conversation, text: string): Conversation {
  if (conversation.messages.some((message) => message.messageType === 'user')) return conversation
  return { ...conversation, title: provisionalTitle(text), titleProvisional: true }
}

export function named(conversation: Conversation, title: string): Conversation {
  const { titleProvisional: _settled, ...rest } = conversation
  return { ...rest, title }
}

export function settledTitle(conversation: Conversation): Conversation {
  return conversation.titleProvisional ? named(conversation, conversation.title) : conversation
}

export function keepsProvisionalTitle(local: Conversation | undefined, serverTitle: string | null | undefined): boolean {
  return local?.titleProvisional === true && (!serverTitle || serverTitle === local.title)
}

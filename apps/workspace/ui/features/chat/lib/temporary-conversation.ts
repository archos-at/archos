'use client'

/**
 * Switching a conversation to temporary and back (ADR-0180 rule 2): while it
 * is temporary, nothing from it is kept in the project's, the office's or the
 * person's memory.
 *
 * The flag is the server row's (`conversations.temporary`); the store's
 * `Conversation.temporary` is its copy, and this module is the only writer of
 * that copy besides the list load. Two cases:
 *
 * - **A chat the server does not hold yet.** A new chat gets its row with its
 *   first message, so the switch is kept on the store's conversation and sent
 *   with the create (`ensureServerConversation`). A switch made while that
 *   create is in flight would be lost, so it is settled once the row exists:
 *   one PATCH, and only when the server's answer differs from the store.
 * - **A stored chat.** One PATCH, and the store takes the server's answer.
 *   Never optimistic: „keeps nothing“ on screen while the server still keeps
 *   would be the one wrong claim this control can make.
 */

import { useChatStore } from '../store'
import { isConversationOnServer, whenConversationOnServer } from './conversation-on-server'
import { createdTemporary } from './temporary-created'

const getConversationsClient = async () =>
  (await import('@/adapters/api/conversations-client')).conversationsClient

/** Conversations with a settle already waiting for their create, so two switches wait once. */
const settling = new Set<string>()

function storedTemporary(conversationId: string): boolean {
  const { currentConversation, conversations } = useChatStore.getState()
  const conversation =
    currentConversation?.id === conversationId
      ? currentConversation
      : conversations.find((candidate) => candidate.id === conversationId)
  return conversation?.temporary === true
}

function applyTemporary(conversationId: string, temporary: boolean): void {
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, temporary } : conversation
    ),
    currentConversation:
      state.currentConversation?.id === conversationId
        ? { ...state.currentConversation, temporary }
        : state.currentConversation,
  }))
}

/**
 * The row exists now. If the person's last word differs from what the create
 * answered, say it to the server; if that fails, the store takes the server's
 * word, so the screen never claims a setting the server does not hold.
 */
async function settleAfterCreate(conversationId: string): Promise<void> {
  settling.delete(conversationId)
  const onServer = createdTemporary(conversationId)
  const wanted = storedTemporary(conversationId)
  if (onServer === undefined || onServer === wanted) return
  try {
    const client = await getConversationsClient()
    const conversation = await client.setTemporary(conversationId, wanted)
    applyTemporary(conversationId, conversation.temporary === true)
  } catch {
    applyTemporary(conversationId, onServer)
  }
}

/**
 * Switch the conversation. Resolves once the store says what holds; rejects
 * with the client's `ApiRequestError` when the server refused or failed, and
 * the store is then unchanged.
 */
export async function setConversationTemporary(conversationId: string, temporary: boolean): Promise<void> {
  if (!isConversationOnServer(conversationId)) {
    applyTemporary(conversationId, temporary)
    if (settling.has(conversationId)) return
    settling.add(conversationId)
    whenConversationOnServer(conversationId, () => void settleAfterCreate(conversationId))
    return
  }
  const client = await getConversationsClient()
  const conversation = await client.setTemporary(conversationId, temporary)
  applyTemporary(conversationId, conversation.temporary === true)
}

/** Whether the conversation is temporary, as the store holds it. False for no conversation. */
export function useConversationTemporary(conversationId: string | null | undefined): boolean {
  return useChatStore((state) => {
    if (!conversationId) return false
    if (state.currentConversation?.id === conversationId) return state.currentConversation.temporary === true
    return state.conversations.some((conversation) => conversation.id === conversationId && conversation.temporary === true)
  })
}

/** Specs only. */
export function resetTemporarySettling(): void {
  settling.clear()
}

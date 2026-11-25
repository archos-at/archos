'use client'

import { useSearchParams } from 'next/navigation'
import { useChatStore, type ChatStoreWithHydration } from '@/features/chat/store'
import { selectThreadPhase } from '../lib/thread-phase'
import { useChatArrival } from './use-thread-phase'

const linkedChatPending = (state: ChatStoreWithHydration, linked: string | null): boolean =>
  linked !== null &&
  state.currentConversation?.id !== linked &&
  !(state.serverConversationsLoaded && !state.conversations.some((conversation) => conversation.id === linked))

const useLinkedSession = (): string | null => useSearchParams()?.get('session') ?? null

export function useLinkedChatPending(): boolean {
  const linked = useLinkedSession()
  return useChatStore((state) => linkedChatPending(state, linked))
}

export function useChatStarted(): boolean {
  const linked = useLinkedSession()
  const { resumes } = useChatArrival()
  return useChatStore((state) => {
    if ((state.currentConversation?.messages?.length ?? 0) > 0) return true
    if (linked === null) return resumes === true && selectThreadPhase(state) === 'hydrating'
    if (linkedChatPending(state, linked)) return true
    const phase = selectThreadPhase(state)
    return phase === 'hydrating' || phase === 'loading'
  })
}

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useChatStore } from '@/features/chat/store'
import type { Conversation } from '@/features/chat/types'
import { createElement } from 'react'
import { useChatStarted, useLinkedChatPending } from './use-chat-started'
import { ChatArrivalProvider, type ChatArrival } from './use-thread-phase'

let search = new URLSearchParams()
vi.mock('next/navigation', () => ({ useSearchParams: () => search }))

const linked = (messages: Conversation['messages'] = []): Conversation => ({
  id: 'c-linked',
  userId: 'u1',
  projectId: null,
  title: 'Brandschutz',
  messages,
  createdAt: new Date(2026, 10, 24),
  updatedAt: new Date(2026, 10, 24),
})

describe('useChatStarted', () => {
  beforeEach(() => {
    search = new URLSearchParams()
    useChatStore.setState({
      currentUserId: 'u1',
      projectId: null,
      currentConversation: null,
      conversations: [],
      serverConversationsLoaded: false,
      pendingMessagesFor: null,
    })
  })

  test('a new chat has not started, so its welcome stands from the first paint', () => {
    expect(renderHook(() => useChatStarted()).result.current).toBe(false)
    expect(renderHook(() => useLinkedChatPending()).result.current).toBe(false)
  })

  test('a link to a chat lays out the started chat before the list or its messages arrive, so nothing moves when they do', () => {
    search = new URLSearchParams('session=c-linked')
    expect(renderHook(() => useLinkedChatPending()).result.current).toBe(true)
    expect(renderHook(() => useChatStarted()).result.current).toBe(true)
  })

  test('a linked chat keeps the started layout while its messages load', () => {
    search = new URLSearchParams('session=c-linked')
    useChatStore.setState({ currentConversation: linked(), conversations: [linked()], pendingMessagesFor: 'c-linked' })
    expect(renderHook(() => useLinkedChatPending()).result.current).toBe(false)
    expect(renderHook(() => useChatStarted()).result.current).toBe(true)
  })

  test('a link to a chat the loaded list does not hold falls back to a new chat', () => {
    search = new URLSearchParams('session=c-gone')
    useChatStore.setState({ serverConversationsLoaded: true, conversations: [linked()] })
    expect(renderHook(() => useLinkedChatPending()).result.current).toBe(false)
    expect(renderHook(() => useChatStarted()).result.current).toBe(false)
  })

  test('a cold load that will resume a chat holds the started layout; one that will not stays a new chat', () => {
    useChatStore.setState({ hasHydrated: false })
    const startedWith = (arrival: ChatArrival): boolean =>
      renderHook(() => useChatStarted(), {
        wrapper: ({ children }) => createElement(ChatArrivalProvider, { value: arrival, children }),
      }).result.current
    expect(startedWith({ resumes: true })).toBe(true)
    expect(startedWith({ resumes: false })).toBe(false)
    expect(startedWith({})).toBe(false)
  })
})

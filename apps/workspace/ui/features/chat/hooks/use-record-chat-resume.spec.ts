import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useChatStore } from '@/features/chat/store'
import type { Conversation } from '@/features/chat/types'
import { useRecordChatResume } from './use-record-chat-resume'

const chat = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  userId: 'anna',
  projectId: null,
  title: 'Stellplätze',
  messages: [{ id: 'm1', role: 'user', content: 'Wie viele Stellplätze?', timestamp: new Date() }],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

const clearCookies = (): void => {
  for (const name of document.cookie.split(';').map((part) => part.split('=')[0]!.trim()).filter(Boolean)) {
    document.cookie = `${name}=; path=/; max-age=0`
    document.cookie = `${name}=; path=/app; max-age=0`
  }
}

describe('useRecordChatResume', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '/app/personal/chat')
    clearCookies()
    useChatStore.setState({ hasHydrated: true, currentUserId: 'anna', currentConversation: null, conversations: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
    clearCookies()
  })

  test('tells the server which sides will resume a chat, and stops when one no longer does', () => {
    useChatStore.setState({ conversations: [chat()] })
    renderHook(() => useRecordChatResume())
    expect(document.cookie).toContain('chat_resume.personal=1')

    act(() => {
      useChatStore.setState({ conversations: [chat({ messages: [] })] })
      vi.advanceTimersByTime(1000)
    })
    expect(document.cookie).not.toContain('chat_resume.personal=1')
  })

  test('writes nothing before the store knows what this browser holds', () => {
    useChatStore.setState({ hasHydrated: false, conversations: [chat()] })
    renderHook(() => useRecordChatResume())
    expect(document.cookie).not.toContain('chat_resume.')
  })
})

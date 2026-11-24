import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: { getState: () => ({ enabledDataSourceIds: [], availableDataSources: [], setEnabledDataSources: vi.fn() }) },
}))
vi.mock('@/adapters/api/deep-research-client', () => ({ getJobStatus: vi.fn(), cancelJob: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/features/documents/discard-session-resources', () => ({ discardSessionDocumentsResources: vi.fn() }))

const nav = vi.hoisted(() => ({ pathname: '/app/personal/chat', search: new URLSearchParams(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.search,
}))

import { useChatStore } from '@/features/chat/store'
import type { Conversation } from '@/features/chat/types'
import { useSessionUrl } from './use-session-url'

const chat = (id: string, projectId: string | null, minutesAgo: number): Conversation => {
  const at = new Date(Date.now() - minutesAgo * 60_000)
  return {
    id,
    userId: 'u1',
    projectId,
    title: id,
    messages: [{ id: `${id}-m`, role: 'user', content: 'Hallo', timestamp: at }],
    createdAt: at,
    updatedAt: at,
  }
}

const dere = chat('s_dere', null, 1)
const holzbau = chat('s_holzbau', 'p1', 30)

beforeEach(() => {
  nav.replace.mockReset()
  nav.search = new URLSearchParams()
})
afterEach(() => {
  useChatStore.setState({ currentConversation: null, conversations: [], projectId: null, currentUserId: null })
})

describe('a side switch never carries a chat over (the owner’s report from staging, 2026-11-24)', () => {
  test('Persönlich „dere“ → Projekt: the project chat opens without the personal chat, and its URL never names it', () => {
    useChatStore.setState({ currentUserId: 'u1', projectId: null, currentConversation: dere, conversations: [dere, holzbau] })
    nav.pathname = '/app/projects/p1/chat'

    const { rerender } = renderHook(() => useSessionUrl({ isAuthenticated: true }))
    act(() => useChatStore.getState().enterSide('p1'))
    rerender()

    expect(useChatStore.getState().currentConversation?.id).not.toBe('s_dere')
    expect(nav.replace.mock.calls.flat().join(' ')).not.toContain('s_dere')
  })

  test('Projekt → Persönlich: the newest project chat is never resumed on the personal side', () => {
    const recentProject = chat('s_recent_project', 'p1', 1)
    const olderPersonal = chat('s_older_personal', null, 30)
    useChatStore.setState({ currentUserId: 'u1', projectId: 'p1', currentConversation: recentProject, conversations: [recentProject, olderPersonal] })
    nav.pathname = '/app/personal/chat'

    const { rerender } = renderHook(() => useSessionUrl({ isAuthenticated: true }))
    act(() => useChatStore.getState().enterSide(null))
    rerender()

    expect(useChatStore.getState().currentConversation?.projectId ?? null).toBeNull()
    expect(nav.replace.mock.calls.flat().join(' ')).not.toContain('s_recent_project')
  })

  test('project A → project B: A’s chat never shows under B', () => {
    const a = chat('s_a', 'p1', 1)
    useChatStore.setState({ currentUserId: 'u1', projectId: 'p1', currentConversation: a, conversations: [a] })
    nav.pathname = '/app/projects/p2/chat'

    const { rerender } = renderHook(() => useSessionUrl({ isAuthenticated: true }))
    act(() => useChatStore.getState().enterSide('p2'))
    rerender()

    expect(useChatStore.getState().currentConversation).toBeNull()
    expect(nav.replace.mock.calls.flat().join(' ')).not.toContain('s_a')
  })

  test('a link to the other side’s chat never opens it here', () => {
    useChatStore.setState({ currentUserId: 'u1', projectId: 'p1', currentConversation: null, conversations: [dere] })

    useChatStore.getState().selectConversation('s_dere')

    expect(useChatStore.getState().currentConversation).toBeNull()
    expect(useChatStore.getState().getUserConversations().map((c) => c.id)).toEqual([])
  })
})

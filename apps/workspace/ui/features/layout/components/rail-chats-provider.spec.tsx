import { render, screen } from '@/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RAIL_CHAT_LIMIT, useRailChats } from '@/components/shell/rail-chats'
import { useChatStore } from '@/features/chat/store'
import type { Conversation } from '@/features/chat/types'
import { useLayoutStore } from '../store'
import { RailChatsProvider } from './rail-chats-provider'

vi.mock('next/navigation', () => ({ usePathname: () => '' }))

const day = (n: number): Date => new Date(2026, 10, n)

const conversation = (id: string, updatedAt: Date, over: Partial<Conversation> = {}): Conversation => ({
  id,
  userId: 'u1',
  projectId: 'p1',
  title: `Chat ${id}`,
  messages: [],
  createdAt: updatedAt,
  updatedAt,
  ...over,
})

let captured: ReturnType<typeof useRailChats> = null
function Probe(): null {
  captured = useRailChats()
  return null
}

const show = (pathname: string) =>
  render(
    <RailChatsProvider pathname={pathname}>
      <Probe />
    </RailChatsProvider>
  )

describe('RailChatsProvider', () => {
  const selectConversation = vi.fn()

  beforeEach(() => {
    captured = null
    selectConversation.mockReset()
    const mine = [1, 2, 3, 4, 5, 6, 7].map((n) => conversation(`c${n}`, day(n)))
    useChatStore.setState({
      currentUserId: 'u1',
      projectId: 'p2',
      conversations: [
        ...mine,
        conversation('other-project', day(9), { projectId: 'p2' }),
        conversation('colleague', day(9), { userId: 'u2' }),
        conversation('untitled', day(8), { title: '' }),
      ],
      currentConversation: mine[5]!,
      selectConversation,
    })
    useLayoutStore.setState({ isSessionsPanelOpen: false })
  })

  test('every chat of the reader, in every project and none, newest first, each opening where it belongs (ADR-0193)', () => {
    useChatStore.setState({
      conversations: [...useChatStore.getState().conversations, conversation('alone', day(10), { projectId: null, shared: false })],
    })
    show('/app/projects/p1/files')
    expect(captured?.items.map((item) => item.id)).toEqual(['alone', 'other-project', 'untitled', 'c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'c1'])
    expect(captured?.items.find((item) => item.id === 'untitled')?.title).toBe('Untitled chat')
    expect(captured?.items.find((item) => item.id === 'c7')?.href).toBe('/app/projects/p1/chat?session=c7')
    expect(captured?.items.find((item) => item.id === 'other-project')?.href).toBe('/app/projects/p2/chat?session=other-project')
    expect(captured?.items.find((item) => item.id === 'alone')?.href).toBe('/app/personal/chat?session=alone')
    expect(captured?.items.find((item) => item.id === 'other-project')?.projectId).toBe('p2')
    expect(captured?.allHref).toBe('/app/projects/p1/chat')
  })

  test('the same list on the personal side, and its „Alle Chats“ is the personal chat', () => {
    show('/app/personal-shelf')
    expect(captured?.items.map((item) => item.id)).toContain('c7')
    expect(captured?.allHref).toBe('/app/personal/chat')
  })

  test('a shared chat says so', () => {
    useChatStore.setState({ conversations: [conversation('shared', day(9), { shared: true }), conversation('mine', day(8))] })
    show('/app/projects/p1/files')
    expect(captured?.items.map((item) => [item.id, item.shared])).toEqual([
      ['shared', true],
      ['mine', false],
    ])
  })

  test('lists at most RAIL_CHAT_LIMIT, the newest', () => {
    const many = Array.from({ length: RAIL_CHAT_LIMIT + 5 }, (_, i) => conversation(`m${i}`, day(i + 1)))
    useChatStore.setState({ conversations: many })
    show('/app/projects/p1/files')
    expect(captured?.items).toHaveLength(RAIL_CHAT_LIMIT)
    expect(captured?.items[0]?.id).toBe(`m${RAIL_CHAT_LIMIT + 4}`)
  })

  test('the open chat is current on the chat route only', () => {
    show('/app/projects/p1/files')
    expect(captured?.items.some((item) => item.current)).toBe(false)
    show('/app/projects/p1/chat')
    expect(captured?.items.filter((item) => item.current).map((item) => item.id)).toEqual(['c6'])
  })

  test('a chat the reader may no longer read keeps its neutral title (ADR-0088)', () => {
    useChatStore.setState({ conversations: [conversation('locked', day(9), { title: '', contentLocked: true })] })
    show('/app/projects/p1/files')
    expect(captured?.items.map((item) => item.title)).toEqual(['Shared chat'])
  })

  test('on the chat route a row switches the store’s thread, elsewhere the link alone carries it', () => {
    show('/app/projects/p1/files')
    captured?.onOpen?.('c4')
    expect(selectConversation).not.toHaveBeenCalled()
    show('/app/projects/p1/chat')
    captured?.onOpen?.('other-project')
    expect(selectConversation).not.toHaveBeenCalled()
    captured?.onOpen?.('c4')
    expect(selectConversation).toHaveBeenCalledWith('c4')
  })

  test('„Alle Chats“ opens the history sheet', () => {
    show('/app/projects/p1/files')
    captured?.onOpenAll?.()
    expect(useLayoutStore.getState().isSessionsPanelOpen).toBe(true)
  })

  test('outside a project there is no source', () => {
    show('/app/projects')
    expect(captured).toBeNull()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  test('a row carries what its chat is doing, so the rail can show it from any page', () => {
    useChatStore.setState({ turns: {}, unseenAnswers: { c2: 'answered' } })
    useChatStore.getState().beginTurn('c4', 'turn-1')
    show('/app/projects/p1/files')
    const activityOf = (id: string) => captured?.items.find((item) => item.id === id)?.activity
    expect(activityOf('c4')).toBe('working')
    expect(activityOf('c2')).toBe('answered')
    expect(activityOf('c3')).toBeNull()
  })
})

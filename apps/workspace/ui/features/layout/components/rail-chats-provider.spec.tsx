/**
 * The rail's last chats are the history sheet's own rows for the project the page is in: up to `RAIL_CHAT_LIMIT`, newest first, the
 * open one current only on the chat route, and a row on the chat route switches the thread the store shows.
 */

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
      // The store's project is whichever chat was open last: the rail goes by the page's.
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

  test('the page’s project, the reader’s own chats, newest first', () => {
    show('/app/projects/p1/files')
    expect(captured?.items.map((item) => item.id)).toEqual(['untitled', 'c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'c1'])
    expect(captured?.items[0]?.title).toBe('Untitled chat')
    expect(captured?.items[1]?.href).toBe('/app/projects/p1/chat?session=c7')
    expect(captured?.allHref).toBe('/app/projects/p1/chat')
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

  test('a project nobody has chatted in has no rows', () => {
    show('/app/projects/p3/files')
    expect(captured?.items).toEqual([])
  })

  test('on the chat route a row switches the store’s thread, elsewhere the link alone carries it', () => {
    show('/app/projects/p1/files')
    captured?.onOpen?.('c4')
    expect(selectConversation).not.toHaveBeenCalled()
    show('/app/projects/p1/chat')
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
})

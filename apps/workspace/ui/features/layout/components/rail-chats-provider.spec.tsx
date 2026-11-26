import { act, render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RAIL_CHAT_LIMIT, useRailChats } from '@/components/shell/rail-chats'
import { useRailSide } from '@/components/shell/rail-side'
import { recordRecentProject } from '@/components/shell/recent-projects'
import { useChatStore } from '@/features/chat/store'
import type { Conversation } from '@/features/chat/types'
import { useLayoutStore } from '../store'
import { RailChatsProvider } from './rail-chats-provider'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: () => '', useRouter: () => ({ replace }) }))

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

const confirmEverySide = (): void => {
  const ids = useChatStore.getState().conversations.map((c) => c.id)
  const listing = { ids, since: Number.MAX_SAFE_INTEGER }
  useChatStore.setState({ serverSides: { 'personal:': listing, 'project:p1': listing, 'project:p2': listing } })
}

const show = (pathname: string, { confirmed = true }: { confirmed?: boolean } = {}) => {
  if (confirmed) confirmEverySide()
  return render(
    <RailChatsProvider projectIds={['p1', 'p2']} pathname={pathname}>
      <Probe />
    </RailChatsProvider>
  )
}

describe('RailChatsProvider', () => {
  const selectConversation = vi.fn()
  const loadServerConversations = vi.fn(async () => {})

  beforeEach(() => {
    captured = null
    selectConversation.mockReset()
    loadServerConversations.mockClear()
    const mine = [1, 2, 3, 4, 5, 6, 7].map((n) => conversation(`c${n}`, day(n)))
    useChatStore.setState({
      currentUserId: 'u1',
      projectId: 'p2',
      conversations: [
        ...mine,
        conversation('other-project', day(9), { projectId: 'p2' }),
        conversation('colleague', day(9), { userId: 'u2' }),
        conversation('untitled', day(8), { title: '', messages: [{ id: 'u1', role: 'user', content: 'Frage', timestamp: day(8) } as never] }),
      ],
      currentConversation: mine[5]!,
      selectConversation,
      loadServerConversations,
    })
    useLayoutStore.setState({ isSessionsPanelOpen: false })
  })

  test('Projekt lists only this project’s chats of the reader, newest first, each opening in it (ADR-0193)', () => {
    useChatStore.setState({
      conversations: [...useChatStore.getState().conversations, conversation('alone', day(10), { projectId: null })],
    })
    show('/app/projects/p1/files')
    expect(captured?.items.map((item) => item.id)).toEqual(['untitled', 'c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'c1'])
    expect(captured?.items.find((item) => item.id === 'untitled')?.title).toBe('Untitled chat')
    expect(captured?.items.find((item) => item.id === 'c7')?.href).toBe('/app/projects/p1/chat?session=c7')
    expect(captured?.allHref).toBe('/app/projects/p1/chat')
  })

  test('Persönlich lists only the chats without a project, and its „Alle Chats“ is the personal chat', () => {
    useChatStore.setState({
      conversations: [
        ...useChatStore.getState().conversations,
        conversation('alone', day(10), { projectId: null }),
        conversation('shared-alone', day(11), { projectId: null, shared: true }),
      ],
    })
    show('/app/personal-shelf')
    expect(captured?.items.map((item) => [item.id, item.shared])).toEqual([
      ['shared-alone', true],
      ['alone', false],
    ])
    expect(captured?.items.find((item) => item.id === 'alone')?.href).toBe('/app/personal/chat?session=alone')
    expect(captured?.allHref).toBe('/app/personal/chat')
  })

  test('each side asks the server for its own newest chats', () => {
    show('/app/personal-shelf')
    expect(loadServerConversations).toHaveBeenNthCalledWith(1, undefined, 'personal')
    loadServerConversations.mockClear()
    show('/app/projects/p1/files')
    expect(loadServerConversations).toHaveBeenNthCalledWith(1, 'p1', 'project')
  })

  test('another person signing in while the rail stays mounted asks for their side again', () => {
    show('/app/personal-shelf')
    loadServerConversations.mockClear()
    act(() => useChatStore.setState({ currentUserId: 'u2' }))
    expect(loadServerConversations).toHaveBeenCalledWith(undefined, 'personal')
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

  test('a row renames its chat, and deletes it only after the question, leaving the chat page when it was open', async () => {
    const updateConversationTitle = vi.fn()
    const deleteConversation = vi.fn()
    useChatStore.setState({ projectId: 'p1', updateConversationTitle, deleteConversation })
    const user = userEvent.setup()
    show('/app/projects/p1/chat')

    act(() => captured?.onRename?.('c6', 'Stellplätze'))
    expect(updateConversationTitle).toHaveBeenCalledWith('c6', 'Stellplätze')

    act(() => captured?.onDelete?.('c6'))
    expect(deleteConversation).not.toHaveBeenCalled()
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /delete/i }))

    expect(deleteConversation).toHaveBeenCalledWith('c6')
    expect(replace).toHaveBeenCalledWith('/app/projects/p1/chat')
  })

  describe('at most eight chats a side, the open one always among them', () => {
    const many = (count: number) => Array.from({ length: count }, (_, i) => conversation(`m${i}`, day(30 - i)))

    test('eight at most, the newest, and „Alle Chats“ while there are more', () => {
      useChatStore.setState({ conversations: many(12), currentConversation: null })
      show('/app/projects/p1/files')
      expect(RAIL_CHAT_LIMIT).toBe(8)
      expect(captured?.items.map((item) => item.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'])
      expect(captured?.more).toBe(true)
    })

    test('the open chat stays when it is older than the eighth: the seven newest and it', () => {
      const chats = many(12)
      useChatStore.setState({ conversations: chats, currentConversation: chats[10]! })
      show('/app/projects/p1/chat')
      const ids = captured?.items.map((item) => item.id)
      expect(ids).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm10'])
      expect(captured?.items.at(-1)?.current).toBe(true)
    })

    test('no „Alle Chats“ when every chat is listed', () => {
      useChatStore.setState({ conversations: many(5), currentConversation: null })
      show('/app/projects/p1/files')
      expect(captured?.items).toHaveLength(5)
      expect(captured?.more).toBe(false)
    })
  })

  describe('only what the server confirms for the side, and never an unsent chat', () => {
    test('a chat nobody has written in is not listed, on either side', () => {
      useChatStore.setState({
        conversations: [conversation('sent', day(8)), conversation('draft', day(9), { title: '' })],
        currentConversation: null,
      })
      show('/app/projects/p1/files')
      expect(captured?.items.map((item) => item.id)).toEqual(['sent'])
    })

    test('a row the server no longer returns for the side is dropped: a stale or deleted chat does not come back', () => {
      useChatStore.setState({
        conversations: [conversation('kept', day(8)), conversation('gone', day(9))],
        currentConversation: null,
        serverSides: { 'project:p1': { ids: ['kept'], since: +day(20) } },
      })
      show('/app/projects/p1/files', { confirmed: false })
      expect(captured?.items.map((item) => item.id)).toEqual(['kept'])
    })

    test('a chat started after the server answered stays, until the next answer includes it', () => {
      useChatStore.setState({
        conversations: [conversation('kept', day(8)), conversation('new', day(21))],
        currentConversation: null,
        serverSides: { 'project:p1': { ids: ['kept'], since: +day(20) } },
      })
      show('/app/projects/p1/files', { confirmed: false })
      expect(captured?.items.map((item) => item.id)).toEqual(['new', 'kept'])
    })

    test('before the server has answered for the side, only the open chat stands', () => {
      useChatStore.setState({ conversations: [conversation('local', day(8))], currentConversation: null, serverSides: {} })
      show('/app/projects/p1/files', { confirmed: false })
      expect(captured).not.toBeNull()
      expect(captured?.items).toEqual([])
    })
  })

  describe('switching the side (the rail’s transition)', () => {
    beforeEach(() => {
      useRailSide.getState().settle()
      useChatStore.setState({
        conversations: [
          conversation('mine-personal', day(9), { projectId: null }),
          conversation('in-p1', day(8), { projectId: 'p1' }),
        ],
      })
    })

    test('the other side’s chats stand at once, never an empty list, before the route lands', () => {
      show('/app/personal-shelf')
      expect(captured?.items.map((item) => item.id)).toEqual(['mine-personal'])

      act(() => useRailSide.getState().begin({ mode: 'project', projectId: 'p1' }))

      expect(captured?.items.map((item) => item.id)).toEqual(['in-p1'])
      expect(captured?.allHref).toBe('/app/projects/p1/chat')
    })

    test('mounting the rail warms the other side’s chats once, beside its own', () => {
      recordRecentProject('p1')
      show('/app/personal-shelf')
      expect(loadServerConversations.mock.calls).toEqual([
        [undefined, 'personal'],
        ['p1', 'project'],
      ])
    })

    test('a project last opened in another office is not warmed: its chats would answer 404 here', () => {
      recordRecentProject('p1')
      recordRecentProject('other-office')
      show('/app/personal-shelf')
      expect(loadServerConversations.mock.calls).toEqual([
        [undefined, 'personal'],
        ['p1', 'project'],
      ])
    })
  })
})

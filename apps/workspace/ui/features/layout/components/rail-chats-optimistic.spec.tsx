import { act, render, waitFor } from '@/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useRailChats } from '@/components/shell/rail-chats'
import { useChatStore } from '@/features/chat/store'
import { forgetSideLoads } from '@/features/chat/stores/session-server-sync'
import type { ChatMessage, Conversation } from '@/features/chat/types'
import { RailChatsProvider } from './rail-chats-provider'

vi.mock('next/navigation', () => ({ usePathname: () => '', useRouter: () => ({ replace: vi.fn() }) }))

const client = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn().mockResolvedValue(undefined),
  createMessage: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  listReadableMessages: vi.fn().mockResolvedValue({ messages: [] }),
  generateTitle: vi.fn(),
  updateTitle: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/adapters/api/conversations-client', () => ({ conversationsClient: client }))

const day = (n: number): Date => new Date(2026, 10, n)
const said = (id: string, messageType: 'user' | 'agent_response', content: string): ChatMessage => ({
  id,
  role: messageType === 'user' ? 'user' : 'assistant',
  content,
  timestamp: day(10),
  messageType,
})
const chat = (id: string, at: Date, over: Partial<Conversation> = {}): Conversation => ({
  id,
  userId: 'u1',
  projectId: null,
  title: `Chat ${id}`,
  messages: [],
  createdAt: at,
  updatedAt: at,
  ...over,
})

let captured: ReturnType<typeof useRailChats> = null
function Probe(): null {
  captured = useRailChats()
  return null
}
const show = (pathname = '/app/personal/chat') =>
  render(
    <RailChatsProvider pathname={pathname}>
      <Probe />
    </RailChatsProvider>
  )
const rows = () => captured?.items.map((item) => ({ id: item.id, title: item.title, provisional: item.provisional === true, current: item.current }))

beforeEach(() => {
  vi.clearAllMocks()
  forgetSideLoads()
  client.list.mockReturnValue(new Promise(() => {}))
  captured = null
  useChatStore.setState({
    currentUserId: 'u1',
    projectId: null,
    conversations: [chat('older', day(8))],
    currentConversation: null,
    turns: {},
    unseenAnswers: {},
    serverSides: { 'personal:': { ids: ['older'], since: +day(9) } },
  })
})

describe('Letzte Chats takes a new chat the moment its first message is sent', () => {
  test('on top, current and working, titled by its first line until it has a name, with no wait for the server', () => {
    show()
    let messageId = ''
    act(() => {
      messageId = useChatStore.getState().addUserMessage('Stellplätze Tiefgarage\nmit Details').id
      useChatStore.getState().beginTurn(useChatStore.getState().currentConversation!.id, messageId)
    })

    const id = useChatStore.getState().currentConversation!.id
    expect(rows()).toEqual([
      { id, title: 'Stellplätze Tiefgarage', provisional: true, current: true },
      { id: 'older', title: 'Chat older', provisional: false, current: false },
    ])
    expect(captured?.items[0]?.activity).toBe('working')
  })

  test('the generated title replaces the first line in place: the row keeps its place and its date', async () => {
    const named = chat('named', day(10), {
      title: 'Wie viele Stellplätze',
      titleProvisional: true,
      messages: [said('q', 'user', 'Wie viele Stellplätze'), said('a', 'agent_response', 'Zwölf.')],
    })
    useChatStore.setState({
      conversations: [named, chat('newer', day(11))],
      serverSides: { 'personal:': { ids: ['named', 'newer'], since: +day(12) } },
    })
    client.generateTitle.mockResolvedValue({ title: 'Stellplatznachweis' })
    show('/app/personal-shelf')

    await act(async () => useChatStore.getState().maybeGenerateConversationName('named'))

    await waitFor(() => expect(rows()?.[1]).toEqual({ id: 'named', title: 'Stellplatznachweis', provisional: false, current: false }))
    expect(rows()?.[0]?.id).toBe('newer')
    expect(useChatStore.getState().conversations.find((c) => c.id === 'named')?.updatedAt).toEqual(day(10))
  })

  test('when no name comes, the first line stays as the title and stops being provisional', async () => {
    useChatStore.setState({
      conversations: [chat('unnamed', day(10), { title: 'Frage', titleProvisional: true, messages: [said('q', 'user', 'Frage'), said('a', 'agent_response', 'Antwort')] })],
      serverSides: { 'personal:': { ids: ['unnamed'], since: +day(12) } },
    })
    client.generateTitle.mockRejectedValue(new Error('down'))
    show('/app/personal-shelf')

    await act(async () => useChatStore.getState().maybeGenerateConversationName('unnamed'))

    await waitFor(() => expect(rows()).toEqual([{ id: 'unnamed', title: 'Frage', provisional: false, current: false }]))
  })

  test('a provisional chat with no words yet shows a pending title, never „Untitled chat“', () => {
    const pending = chat('pending', day(10), { title: '', titleProvisional: true, messages: [said('q', 'user', '')] })
    useChatStore.setState({ conversations: [pending], currentConversation: pending })
    show()
    expect(rows()).toEqual([{ id: 'pending', title: '', provisional: true, current: true }])
  })

  test('a deleted chat leaves the rail', async () => {
    show()
    act(() => void useChatStore.getState().addUserMessage('Kurz gefragt'))
    const id = useChatStore.getState().currentConversation!.id
    expect(rows()?.[0]?.id).toBe(id)

    await act(async () => useChatStore.getState().deleteConversation(id))

    expect(rows()?.map((row) => row.id)).toEqual(['older'])
  })

  test('a provisional chat the server does not list and that is not open stays out', () => {
    useChatStore.setState({
      conversations: [chat('stale', day(8), { title: 'Alt', titleProvisional: true }), chat('older', day(7))],
      serverSides: { 'personal:': { ids: ['older'], since: +day(9) } },
    })
    show('/app/personal-shelf')
    expect(rows()?.map((row) => row.id)).toEqual(['older'])
  })
})

describe('the server listing and a provisional title', () => {
  const provisional = () => chat('mine', day(10), { title: 'Erste Zeile', titleProvisional: true })

  test('a listing that still carries the first line keeps it provisional', async () => {
    useChatStore.setState({ conversations: [provisional()] })
    client.list.mockResolvedValue([{ id: 'mine', title: 'Erste Zeile', projectId: null, createdAt: day(10), updatedAt: day(10) }])
    await useChatStore.getState().loadServerConversations(undefined, 'personal')
    expect(useChatStore.getState().conversations[0]).toMatchObject({ title: 'Erste Zeile', titleProvisional: true })
  })

  test('a listing with a name settles it', async () => {
    useChatStore.setState({ conversations: [provisional()] })
    client.list.mockResolvedValue([{ id: 'mine', title: 'Stellplatznachweis', projectId: null, createdAt: day(10), updatedAt: day(10) }])
    await useChatStore.getState().loadServerConversations(undefined, 'personal')
    expect(useChatStore.getState().conversations[0]?.title).toBe('Stellplatznachweis')
    expect(useChatStore.getState().conversations[0]?.titleProvisional).toBeUndefined()
  })
})

describe('while a side’s first listing is on its way', () => {
  test('the list says it is loading, and stops once the server answers', async () => {
    let answer: (rows: unknown[]) => void = () => {}
    client.list.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    useChatStore.setState({ serverSides: {} })
    show('/app/personal-shelf')
    expect(captured?.loading).toBe(true)

    await act(async () => answer([]))

    await waitFor(() => expect(captured?.loading).toBe(false))
  })

  test('a side the rail has already listed shows its rows, not a skeleton, while it refreshes', () => {
    show('/app/personal-shelf')
    expect(captured?.loading).toBe(false)
    expect(rows()?.map((row) => row.id)).toEqual(['older'])
  })

  test('a failed listing ends the skeleton too', async () => {
    client.list.mockRejectedValue(new Error('offline'))
    useChatStore.setState({ serverSides: {} })
    show('/app/personal-shelf')
    await waitFor(() => expect(captured?.loading).toBe(false))
  })
})

describe('a provisional title always ends', () => {
  const asking = () => chat('asking', day(10), { title: 'Frage', titleProvisional: true, messages: [said('q', 'user', 'Frage')] })

  test('a turn that fails before any answer settles it', () => {
    useChatStore.setState({ conversations: [asking()], currentConversation: null })
    useChatStore.getState().beginTurn('asking', 'q')
    useChatStore.getState().failTurn('q')
    expect(useChatStore.getState().conversations[0]).toMatchObject({ title: 'Frage' })
    expect(useChatStore.getState().conversations[0]?.titleProvisional).toBeUndefined()
  })

  test('a turn that is dropped settles it', () => {
    useChatStore.setState({ conversations: [asking()], currentConversation: null })
    useChatStore.getState().beginTurn('asking', 'q')
    useChatStore.getState().dropTurn('q')
    expect(useChatStore.getState().conversations[0]?.titleProvisional).toBeUndefined()
  })

  test('a chat the reader loses the rights to is no longer waiting for a name', () => {
    useChatStore.setState({ conversations: [asking()], currentConversation: null })
    useChatStore.getState()._lockConversation('asking')
    expect(useChatStore.getState().conversations[0]).toMatchObject({ title: '', contentLocked: true })
    expect(useChatStore.getState().conversations[0]?.titleProvisional).toBeUndefined()
  })

  test('a rename while the name is being generated wins over the generated name', async () => {
    let answer: (result: { title: string }) => void = () => {}
    client.generateTitle.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    useChatStore.setState({
      conversations: [chat('both', day(10), { title: 'Frage', titleProvisional: true, messages: [said('q', 'user', 'Frage'), said('a', 'agent_response', 'Antwort')] })],
      currentConversation: null,
    })
    useChatStore.getState().maybeGenerateConversationName('both')
    await waitFor(() => expect(client.generateTitle).toHaveBeenCalled())
    useChatStore.getState().updateConversationTitle('both', 'Mein Name')

    await act(async () => answer({ title: 'Generiert' }))

    expect(useChatStore.getState().conversations[0]?.title).toBe('Mein Name')
    expect(client.updateTitle).toHaveBeenCalledTimes(1)
  })
})

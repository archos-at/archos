import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { SessionsPanel } from './SessionsPanel'
import type { ResearchRun } from '@/adapters/api/research-runs-client'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { LayoutStore } from '../types'
import type { ChatStoreWithHydration } from '@/features/chat/store'

const mockSetSessionsPanelOpen = vi.fn()

const mockListResearchRuns = vi.fn()
vi.mock('@/adapters/api/research-runs-client', () => ({
  listResearchRuns: (...args: unknown[]) => mockListResearchRuns(...args),
}))

const mockCancelJob = vi.fn()
vi.mock('@/adapters/api/deep-research-client', () => ({
  cancelJob: (...args: unknown[]) => mockCancelJob(...args),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('../store', () => ({
  useLayoutStore: vi.fn((selector?: StoreSelector<LayoutStore>) => {
    const state: DeepPartial<LayoutStore> = {
      isSessionsPanelOpen: true,
      setSessionsPanelOpen: mockSetSessionsPanelOpen,
    }
    return selector ? selector(asStoreState<LayoutStore>(state)) : state
  }),
}))

vi.mock('@/features/chat/store', () => ({
  useChatStore: vi.fn(),
}))

vi.mock('./DeleteSessionConfirmationModal', () => ({
  DeleteSessionConfirmationModal: ({
    open,
    onConfirm,
    onOpenChange,
  }: {
    open: boolean
    onConfirm: () => void
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div data-testid="delete-modal">
        <button onClick={onConfirm}>Confirm Delete</button>
        <button onClick={() => onOpenChange(false)}>Cancel</button>
      </div>
    ) : null,
}))

import { useLayoutStore } from '../store'
import { useChatStore } from '@/features/chat/store'

const createMockChatState = (
  overrides: {
    isSessionBusy?: (sessionId: string) => boolean
    hasAnyBusySession?: () => boolean
    isStreaming?: boolean
    pendingInteraction?: { turnId: string; interactionId: string; input: 'text' | 'choice' } | null
  } = {}
) => ({
  isSessionBusy: overrides.isSessionBusy ?? (() => false),
  hasAnyBusySession: overrides.hasAnyBusySession ?? (() => false),
  isStreaming: overrides.isStreaming ?? false,
  pendingInteraction: overrides.pendingInteraction ?? null,
})

const setupChatStoreMock = (overrides: Parameters<typeof createMockChatState>[0] = {}) => {
  const state = createMockChatState(overrides)
  vi.mocked(useChatStore).mockImplementation((selector: StoreSelector<ChatStoreWithHydration>) => {
    if (typeof selector === 'function') {
      return selector(asStoreState<ChatStoreWithHydration>(state))
    }
    return undefined
  })
}

const rowOf = (element: HTMLElement): HTMLElement => {
  const row = element.closest('li')
  if (!row) throw new Error('expected the element to sit inside a list row')
  return row
}

describe('SessionsPanel', () => {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const mockSessions = [
    { id: 'session-1', title: 'First Session', date: today },
    { id: 'session-2', title: 'Second Session', date: yesterday },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    setupChatStoreMock()

    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: true,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })
  })

  test('renders panel with heading', () => {
    render(<SessionsPanel sessions={mockSessions} />)

    expect(screen.getByText('Chat history')).toBeInTheDocument()
  })

  test('renders the new-chat button', () => {
    render(<SessionsPanel sessions={mockSessions} />)

    expect(screen.getByRole('button', { name: /start a new chat/i })).toBeInTheDocument()
  })

  test('states how many chats the project has', () => {
    render(<SessionsPanel sessions={mockSessions} />)

    expect(screen.getByText('2 chats')).toBeInTheDocument()
  })

  test('renders session list grouped by date', () => {
    render(<SessionsPanel sessions={mockSessions} />)

    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    expect(screen.getByText('First Session')).toBeInTheDocument()
    expect(screen.getByText('Second Session')).toBeInTheDocument()
  })

  test('does not render the scope filter when the research section is off', () => {
    render(<SessionsPanel sessions={mockSessions} />)

    expect(screen.queryByRole('radiogroup', { name: /filter history/i })).not.toBeInTheDocument()
  })

  test('shows empty state when no sessions', () => {
    render(<SessionsPanel sessions={[]} />)

    expect(screen.getByText('No chats yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /start a new chat/i })).toHaveLength(1)
  })

  test('hides search and delete-all when there is nothing to search or delete', () => {
    render(<SessionsPanel sessions={[]} />)

    expect(screen.queryByRole('textbox', { name: /search chats/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /delete all chats in this project/i })
    ).not.toBeInTheDocument()
  })

  test('shows the search-specific empty state, quoting the query, when nothing matches', async () => {
    const user = userEvent.setup()
    render(<SessionsPanel sessions={mockSessions} />)

    await user.type(screen.getByRole('textbox', { name: /search chats/i }), 'zzzzz')

    expect(screen.getByText('No matching chats')).toBeInTheDocument()
    expect(screen.getByText(/zzzzz/)).toBeInTheDocument()
  })

  test('reports how much of the list the query is hiding', async () => {
    const user = userEvent.setup()
    render(<SessionsPanel sessions={mockSessions} />)

    await user.type(screen.getByRole('textbox', { name: /search chats/i }), 'First')

    expect(screen.getByText('1 of 2 chats')).toBeInTheDocument()
  })

  test('clearing the search restores the full list', async () => {
    const user = userEvent.setup()
    render(<SessionsPanel sessions={mockSessions} />)

    const search = screen.getByRole('textbox', { name: /search chats/i })
    await user.type(search, 'First')
    expect(screen.queryByText('Second Session')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /clear search/i })[0])

    expect(screen.getByText('Second Session')).toBeInTheDocument()
    expect(search).toHaveValue('')
  })

  test('finds an untitled chat by the placeholder the user actually sees', async () => {
    const user = userEvent.setup()
    render(<SessionsPanel sessions={[{ id: 'blank', title: '', date: today }]} />)

    await user.type(screen.getByRole('textbox', { name: /search chats/i }), 'untitled')

    expect(screen.getByRole('button', { name: /chat: untitled chat/i })).toBeInTheDocument()
  })

  test('calls onNewSession when new session button clicked', async () => {
    const user = userEvent.setup()
    const onNewSession = vi.fn()

    render(<SessionsPanel sessions={mockSessions} onNewSession={onNewSession} />)

    await user.click(screen.getByRole('button', { name: /start a new chat/i }))

    expect(onNewSession).toHaveBeenCalled()
    expect(mockSetSessionsPanelOpen).toHaveBeenCalledWith(false)
  })

  test('calls onSelectSession when session clicked', async () => {
    const user = userEvent.setup()
    const onSelectSession = vi.fn()

    render(<SessionsPanel sessions={mockSessions} onSelectSession={onSelectSession} />)

    await user.click(screen.getByRole('button', { name: /chat: first session/i }))

    expect(onSelectSession).toHaveBeenCalledWith('session-1')
    expect(mockSetSessionsPanelOpen).toHaveBeenCalledWith(false)
  })

  test('highlights selected session', () => {
    render(<SessionsPanel sessions={mockSessions} selectedSessionId="session-1" />)

    const firstSession = screen.getByRole('button', { name: /chat: first session/i })
    expect(rowOf(firstSession)).toHaveClass('bg-selected')
    expect(firstSession).toHaveAttribute('aria-current', 'true')
  })

  test('lists a chat the reader may no longer read under a neutral title, with no way to rename it (ADR-0088)', async () => {
    const user = userEvent.setup()
    render(
      <SessionsPanel
        sessions={[...mockSessions, { id: 'session-locked', title: '', date: today, contentLocked: true }]}
      />
    )

    const locked = screen.getByRole('button', { name: /chat: shared chat/i })
    expect(locked).toBeInTheDocument()
    expect(screen.queryByText(/untitled/i)).toBeNull()

    await user.hover(locked)
    expect(screen.getByRole('button', { name: /delete chat/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /rename chat/i })).toBeNull()
  })

  test('marks a temporary chat quietly and says it in the row’s name; other rows carry no mark (ADR-0180)', () => {
    render(
      <SessionsPanel sessions={[...mockSessions, { id: 'session-temp', title: 'Scratch', date: today, temporary: true }]} />
    )

    const temporary = screen.getByRole('button', {
      name: 'Chat: Scratch (temporary chat, nothing from it is kept)',
    })
    const marks = screen.getAllByTestId('session-temporary-mark')
    expect(marks).toHaveLength(1)
    expect(rowOf(temporary)).toContainElement(marks[0])
    expect(marks[0]).toHaveAttribute('title', 'Temporary chat: nothing from it is kept.')
    expect(marks[0].querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Chat: First Session' })).toBeInTheDocument()
  })

  test('shows edit and delete icons on hover', async () => {
    const user = userEvent.setup()
    render(<SessionsPanel sessions={mockSessions} />)

    const sessionItem = screen.getByRole('button', { name: /chat: first session/i })
    await user.hover(sessionItem)

    expect(screen.getByRole('button', { name: /rename chat/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete chat/i })).toBeInTheDocument()
  })

  describe('a finger has no hover: rename and delete get a visible way in', () => {
    test('every row carries a row menu that only a coarse pointer sees', () => {
      render(<SessionsPanel sessions={mockSessions} />)

      const menus = screen.getAllByTestId('session-row-menu')
      expect(menus).toHaveLength(mockSessions.length)
      for (const menu of menus) {
        expect(menu.className).toContain('pointer-coarse:inline-flex')
        expect(menu.className).toContain('hidden')
        expect(menu.className).toContain('size-11')
      }
      expect(menus[0]).toHaveAccessibleName('Actions for "First Session"')
    })

    test('the hover overlay does not draw on a coarse pointer', async () => {
      const user = userEvent.setup()
      render(<SessionsPanel sessions={mockSessions} />)

      await user.hover(screen.getByRole('button', { name: /chat: first session/i }))

      const overlay = screen.getByRole('button', { name: /rename chat/i }).parentElement?.parentElement
      expect(overlay?.className).toContain('pointer-coarse:hidden')
    })

    test('the menu renames: the row turns into its editor', async () => {
      const user = userEvent.setup()
      render(<SessionsPanel sessions={mockSessions} />)

      await user.click(screen.getAllByTestId('session-row-menu')[0]!)
      const item = await screen.findByRole('menuitem', { name: /rename chat/i })
      await user.hover(item)
      await user.click(item)

      expect(await screen.findByRole('textbox', { name: /edit chat title/i })).toHaveValue(
        'First Session'
      )
    })

    test('the menu deletes through the same confirmation as the hover button', async () => {
      const user = userEvent.setup()
      render(<SessionsPanel sessions={mockSessions} />)

      await user.click(screen.getAllByTestId('session-row-menu')[0]!)
      const item = await screen.findByRole('menuitem', { name: /delete chat/i })
      await user.hover(item)
      await user.click(item)

      expect(await screen.findByTestId('delete-modal')).toBeInTheDocument()
    })

    test('a chat the reader may no longer read offers delete, not rename, in the menu', async () => {
      const user = userEvent.setup()
      render(
        <SessionsPanel
          sessions={[{ id: 'session-locked', title: '', date: today, contentLocked: true }]}
        />
      )

      await user.click(screen.getByTestId('session-row-menu'))

      expect(await screen.findByRole('menuitem', { name: /delete chat/i })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /rename chat/i })).toBeNull()
    })
  })

  test('states in the footer where chats actually live: the workspace, not this browser', () => {
    render(<SessionsPanel sessions={mockSessions} />)

    expect(
      screen.getByText(/Chats are saved to your workspace and available on any device/i)
    ).toBeInTheDocument()
  })

  test('says why every row is dimmed while a turn is in flight', () => {
    setupChatStoreMock({ isStreaming: true })

    render(<SessionsPanel sessions={mockSessions} />)

    expect(
      screen.getByText(/Starting or switching chats is paused until it finishes/i)
    ).toBeInTheDocument()
  })

  test('says nothing about the block when nothing is in flight', () => {
    render(<SessionsPanel sessions={mockSessions} />)

    expect(screen.queryByText(/switching chats is paused/i)).not.toBeInTheDocument()
  })

  test('drops a stale query when the panel closes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<SessionsPanel sessions={mockSessions} />)

    await user.type(screen.getByRole('textbox', { name: /search chats/i }), 'First')
    expect(screen.queryByText('Second Session')).not.toBeInTheDocument()

    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: false,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })
    rerender(<SessionsPanel sessions={[...mockSessions]} />)

    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: /search chats/i })).not.toBeInTheDocument()
    })

    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: true,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })
    rerender(<SessionsPanel sessions={[...mockSessions]} />)
    expect(screen.getByRole('textbox', { name: /search chats/i })).toHaveValue('')
    expect(screen.getByText('Second Session')).toBeInTheDocument()
  })

  test('does not show session content when panel is closed', () => {
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: false,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })

    render(<SessionsPanel sessions={mockSessions} />)

    expect(screen.queryByText('Chat history')).not.toBeInTheDocument()
  })

  test('an ordinary chat row is named by its title alone', () => {
    render(<SessionsPanel sessions={mockSessions} />)

    expect(screen.getByRole('button', { name: 'Chat: First Session' })).toBeInTheDocument()
  })

  test('a chat with a finished report says so in its name', () => {
    render(
      <SessionsPanel
        sessions={[
          {
            id: 'session-report',
            title: 'Completed Report',
            date: new Date(),
            hasCompletedReport: true,
          },
        ]}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Chat: Completed Report — Report ready' })
    ).toBeInTheDocument()
  })

  test('a chat the agent is working on says so in its name', () => {
    setupChatStoreMock({
      isSessionBusy: (sessionId: string) => sessionId === 'session-1',
      hasAnyBusySession: () => true,
    })

    render(<SessionsPanel sessions={mockSessions} />)

    expect(
      screen.getByRole('button', { name: 'Chat: First Session — Working on this chat' })
    ).toBeInTheDocument()
  })
})

describe('SessionsPanel - Session Switching', () => {
  const mockSessions = [
    { id: 'session-1', title: 'Deep Research Session', date: new Date() },
    { id: 'session-2', title: 'Idle Session', date: new Date() },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    setupChatStoreMock()
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: true,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })
  })

  test('allows switching sessions during active deep research (server-side SSE)', async () => {
    setupChatStoreMock({
      isSessionBusy: (sessionId: string) => sessionId === 'session-1',
      hasAnyBusySession: () => true,
      isStreaming: false,
      pendingInteraction: null,
    })

    const user = userEvent.setup()
    const onSelectSession = vi.fn()
    render(
      <SessionsPanel
        sessions={mockSessions}
        selectedSessionId="session-2"
        onSelectSession={onSelectSession}
      />
    )

    const deepResearchSession = screen.getByRole('button', {
      name: /chat: deep research session/i,
    })
    expect(rowOf(deepResearchSession)).not.toHaveClass('cursor-not-allowed')
    expect(deepResearchSession).not.toBeDisabled()

    await user.click(deepResearchSession)
    expect(onSelectSession).toHaveBeenCalledWith('session-1')
  })

  test('blocks switching when shallow thinking (WebSocket) is active', async () => {
    setupChatStoreMock({
      isStreaming: true,
      pendingInteraction: null,
    })

    const user = userEvent.setup()
    const onSelectSession = vi.fn()
    render(
      <SessionsPanel
        sessions={mockSessions}
        selectedSessionId="session-1"
        onSelectSession={onSelectSession}
      />
    )

    const session2 = screen.getByRole('button', {
      name: /chat: idle session \(processing in progress\)/i,
    })
    expect(rowOf(session2)).toHaveClass('cursor-not-allowed')
    expect(session2).toBeDisabled()

    await user.click(session2)
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  test('blocks switching when pending HITL interaction exists', async () => {
    setupChatStoreMock({
      isStreaming: false,
      pendingInteraction: { turnId: 'm1', interactionId: 'p1', input: 'text' },
    })

    const user = userEvent.setup()
    const onSelectSession = vi.fn()
    render(
      <SessionsPanel
        sessions={mockSessions}
        selectedSessionId="session-1"
        onSelectSession={onSelectSession}
      />
    )

    const session2 = screen.getByRole('button', {
      name: /chat: idle session \(processing in progress\)/i,
    })
    expect(session2).toBeDisabled()

    await user.click(session2)
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  test('allows switching between sessions when nothing is active', async () => {
    setupChatStoreMock({
      isStreaming: false,
      pendingInteraction: null,
    })

    const user = userEvent.setup()
    const onSelectSession = vi.fn()
    render(
      <SessionsPanel
        sessions={mockSessions}
        selectedSessionId="session-1"
        onSelectSession={onSelectSession}
      />
    )

    const session2 = screen.getByRole('button', { name: /chat: idle session/i })
    expect(rowOf(session2)).not.toHaveClass('cursor-not-allowed')

    await user.click(session2)
    expect(onSelectSession).toHaveBeenCalledWith('session-2')
  })
})

describe('SessionsPanel - New chat button', () => {
  const mockSessions = [{ id: 'session-1', title: 'First Session', date: new Date() }]

  beforeEach(() => {
    vi.clearAllMocks()
    setupChatStoreMock()
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: true,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })
  })

  test('disables new session button when shallow streaming is active', () => {
    setupChatStoreMock({ isStreaming: true })

    render(<SessionsPanel sessions={mockSessions} />)

    const newSessionBtn = screen.getByRole('button', {
      name: /start a new chat \(disabled during active operations\)/i,
    })
    expect(newSessionBtn).toBeDisabled()
  })

  test('disables new session button when HITL interaction is pending', () => {
    setupChatStoreMock({
      pendingInteraction: { turnId: 'm1', interactionId: 'p1', input: 'text' },
    })

    render(<SessionsPanel sessions={mockSessions} />)

    const newSessionBtn = screen.getByRole('button', {
      name: /start a new chat \(disabled during active operations\)/i,
    })
    expect(newSessionBtn).toBeDisabled()
  })

  test('enables new session button during active deep research (server-side)', () => {
    setupChatStoreMock({
      isSessionBusy: (sessionId: string) => sessionId === 'session-1',
      hasAnyBusySession: () => true,
      isStreaming: false,
      pendingInteraction: null,
    })

    render(<SessionsPanel sessions={mockSessions} />)

    const newSessionBtn = screen.getByRole('button', { name: /^start a new chat$/i })
    expect(newSessionBtn).not.toBeDisabled()
  })

  test('enables new session button when no active operations', () => {
    setupChatStoreMock({ isStreaming: false, pendingInteraction: null })

    render(<SessionsPanel sessions={mockSessions} />)

    const newSessionBtn = screen.getByRole('button', { name: /^start a new chat$/i })
    expect(newSessionBtn).not.toBeDisabled()
  })
})

describe('SessionsPanel - Delete Button States', () => {
  const mockSessions = [
    { id: 'session-1', title: 'First Session', date: new Date() },
    { id: 'session-2', title: 'Second Session', date: new Date() },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    setupChatStoreMock()
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: true,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })
  })

  test('disables individual delete button when session has active deep research', async () => {
    setupChatStoreMock({
      isSessionBusy: (sessionId: string) => sessionId === 'session-1',
      hasAnyBusySession: () => true,
      isStreaming: false,
      pendingInteraction: null,
    })

    const user = userEvent.setup()
    render(<SessionsPanel sessions={mockSessions} />)

    const firstSession = screen.getByRole('button', { name: /chat: first session/i })
    await user.hover(firstSession)

    const deleteButton = screen.getByRole('button', { name: /delete chat \(disabled\)/i })
    expect(deleteButton).toBeDisabled()
  })

  test('disables individual delete button when shallow streaming is active (global block)', async () => {
    setupChatStoreMock({ isStreaming: true })

    const user = userEvent.setup()
    render(<SessionsPanel sessions={mockSessions} />)

    const firstSession = screen.getByRole('button', {
      name: /chat: first session \(processing in progress\)/i,
    })
    await user.hover(firstSession)

    const deleteButton = screen.getByRole('button', { name: /delete chat \(disabled\)/i })
    expect(deleteButton).toBeDisabled()
  })

  test('enables delete button when session is idle and no global block', async () => {
    setupChatStoreMock({
      isSessionBusy: () => false,
      hasAnyBusySession: () => false,
      isStreaming: false,
      pendingInteraction: null,
    })

    const user = userEvent.setup()
    render(<SessionsPanel sessions={mockSessions} />)

    const firstSession = screen.getByRole('button', { name: /chat: first session/i })
    await user.hover(firstSession)

    const deleteButton = screen.getByRole('button', { name: /^delete chat$/i })
    expect(deleteButton).not.toBeDisabled()
  })

  test('disables "Delete All" button when any session is busy', () => {
    setupChatStoreMock({
      isSessionBusy: () => false,
      hasAnyBusySession: () => true,
      isStreaming: false,
      pendingInteraction: null,
    })

    render(<SessionsPanel sessions={mockSessions} />)

    const deleteAllButton = screen.getByRole('button', {
      name: /delete all chats in this project \(disabled\)/i,
    })
    expect(deleteAllButton).toBeDisabled()
  })

  test('enables "Delete All" button when no sessions are busy', () => {
    setupChatStoreMock({
      isSessionBusy: () => false,
      hasAnyBusySession: () => false,
      isStreaming: false,
      pendingInteraction: null,
    })

    render(<SessionsPanel sessions={mockSessions} />)

    const deleteAllButton = screen.getByRole('button', {
      name: /^delete all chats in this project$/i,
    })
    expect(deleteAllButton).not.toBeDisabled()
  })

  test('has appropriate title attribute on disabled delete button for active session', async () => {
    setupChatStoreMock({
      isSessionBusy: (sessionId: string) => sessionId === 'session-1',
      hasAnyBusySession: () => true,
      isStreaming: false,
      pendingInteraction: null,
    })

    const user = userEvent.setup()
    render(<SessionsPanel sessions={mockSessions} />)

    const firstSession = screen.getByRole('button', { name: /chat: first session/i })
    await user.hover(firstSession)

    const deleteButton = screen.getByRole('button', { name: /delete chat \(disabled\)/i })
    expect(deleteButton).toHaveAttribute('title', 'Cannot delete while operations are in progress')
  })
})

describe('SessionsPanel - Deep Research section (FB-10)', () => {
  const today = new Date()

  const makeRun = (overrides: Partial<ResearchRun>): ResearchRun => ({
    job_id: 'job-aaaaaaaa1111',
    status: 'completed',
    created_at: today.toISOString(),
    conversation_id: null,
    project_collection: 'proj_1',
    ...overrides,
  })

  const sessions = [{ id: 'conv-1', title: 'Fire safety review', date: today }]

  const renderPanel = (extra: Partial<Parameters<typeof SessionsPanel>[0]> = {}) =>
    render(
      <SessionsPanel
        sessions={sessions}
        projectId="p1"
        {...extra}
      />
    )

  beforeEach(() => {
    vi.clearAllMocks()
    setupChatStoreMock()
    mockListResearchRuns.mockResolvedValue({ jobs: [], total: 0 })
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: true,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })
  })

  test('does not render the section, the filter, or fetch runs outside a project', () => {
    render(<SessionsPanel sessions={sessions} />)

    expect(screen.queryByTestId('deep-research-section')).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: /filter history/i })).not.toBeInTheDocument()
    expect(mockListResearchRuns).not.toHaveBeenCalled()
  })

  test('renders a run count and fetches runs scoped to the project collection', async () => {
    mockListResearchRuns.mockResolvedValue({
      jobs: [makeRun({ job_id: 'job-1' }), makeRun({ job_id: 'job-2' })],
      total: 2,
    })

    renderPanel()

    const section = await screen.findByTestId('deep-research-section')
    await waitFor(() => {
      expect(within(section).getByText('2')).toBeInTheDocument()
    })
    const researchFilter = screen.getByRole('radio', { name: /deep research/i })
    expect(within(researchFilter).getByText('2')).toBeInTheDocument()

    expect(mockListResearchRuns).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1' })
    )
  })

  test('shows runs by default: session-title label, untitled fallback, and thread hrefs', async () => {
    mockListResearchRuns.mockResolvedValue({
      jobs: [
        makeRun({ job_id: 'job-completed', status: 'completed', conversation_id: 'conv-1' }),
        makeRun({ job_id: 'job-failed', status: 'failed', conversation_id: null }),
      ],
      total: 2,
    })

    renderPanel()

    const completed = await screen.findByRole('link', {
      name: /Open deep research run: Fire safety review/i,
    })
    expect(completed.getAttribute('href')).toBe('/app/projects/p1/chat?session=conv-1')

    expect(screen.getByText('Deep research run')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Open deep research run: Deep research run/i })
    ).not.toBeInTheDocument()
  })

  test('a run states its status in words, not only in its icon', async () => {
    mockListResearchRuns.mockResolvedValue({
      jobs: [
        makeRun({ job_id: 'job-ok', status: 'completed', conversation_id: 'conv-1' }),
        makeRun({ job_id: 'job-bad', status: 'failed', conversation_id: 'conv-2' }),
        makeRun({ job_id: 'job-live', status: 'running', conversation_id: 'conv-3' }),
      ],
      total: 3,
    })

    renderPanel()

    expect(await screen.findByText('Report ready')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Open deep research run: .* — Failed/i })
    ).toBeInTheDocument()
  })

  test('marks research-carrying sessions with a Deep Research chip', async () => {
    render(
      <SessionsPanel
        sessions={[{ id: 'conv-1', title: 'Research chat', date: today, hasCompletedReport: true }]}
        projectId="p1"
      />
    )

    const row = screen.getByRole('button', { name: /chat: research chat/i })
    await waitFor(() => {
      expect(within(row).getByText('Deep Research')).toBeInTheDocument()
    })
  })

  test('shows skeleton rows while the first runs fetch is pending', () => {
    mockListResearchRuns.mockReturnValue(new Promise(() => {}))

    renderPanel()

    const skeleton = screen.getByTestId('deep-research-skeleton')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
  })

  test('a failed runs fetch shows a retry line instead of a silently empty section', async () => {
    mockListResearchRuns
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        jobs: [makeRun({ job_id: 'job-1', conversation_id: 'conv-1' })],
        total: 1,
      })

    const user = userEvent.setup()
    renderPanel()

    expect(
      await screen.findByText('Deep-research runs could not be loaded.')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('link', { name: /Open deep research run: Fire safety review/i })
    ).toBeInTheDocument()
    expect(mockListResearchRuns).toHaveBeenCalledTimes(2)
  })

  test('the scope filter shows chats, runs, or both', async () => {
    mockListResearchRuns.mockResolvedValue({
      jobs: [makeRun({ job_id: 'job-1', conversation_id: 'conv-1' })],
      total: 1,
    })

    const user = userEvent.setup()
    renderPanel()

    expect(await screen.findByRole('link', { name: /open deep research run/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chat: fire safety review/i })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Chats' }))
    expect(screen.queryByRole('link', { name: /open deep research run/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chat: fire safety review/i })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /deep research/i }))
    expect(await screen.findByRole('link', { name: /open deep research run/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /chat: fire safety review/i })
    ).not.toBeInTheDocument()
  })

  test('the Deep Research scope shows a proper empty state when there are no runs', async () => {
    const user = userEvent.setup()
    renderPanel()

    await waitFor(() => {
      expect(screen.queryByTestId('deep-research-skeleton')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('deep-research-section')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /deep research/i }))
    expect(await screen.findByText('No deep research runs yet')).toBeInTheDocument()
  })

  test('populates the section after a quick close→reopen while the fetch is pending', async () => {
    let isPanelOpen = true
    let resolveRuns: (value: { jobs: ResearchRun[]; total: number }) => void = () => {}
    mockListResearchRuns.mockReturnValue(
      new Promise((resolve) => {
        resolveRuns = resolve
      })
    )
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: isPanelOpen,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })

    const { rerender } = render(
      <SessionsPanel sessions={sessions} projectId="p1" />
    )

    expect(mockListResearchRuns).toHaveBeenCalledTimes(1)

    isPanelOpen = false
    rerender(
      <SessionsPanel sessions={sessions} projectId="p1" />
    )
    isPanelOpen = true
    rerender(
      <SessionsPanel sessions={sessions} projectId="p1" />
    )

    resolveRuns({
      jobs: [
        makeRun({ job_id: 'job-1', conversation_id: 'conv-1' }),
        makeRun({ job_id: 'job-2', conversation_id: 'conv-2' }),
      ],
      total: 2,
    })

    expect(
      await screen.findAllByRole('link', { name: /open deep research run/i })
    ).toHaveLength(2)
  })
})

describe('SessionsPanel - stopping a run from the history', () => {
  const today = new Date()
  const idleSession = { id: 'conv-idle', title: 'Idle chat', date: today }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCancelJob.mockResolvedValue({ cancelled: true })
    mockListResearchRuns.mockResolvedValue({ jobs: [], total: 0 })
    setupChatStoreMock()
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: true,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })
  })

  test('a chat row offers no stop action: the run is stopped from its block', () => {
    render(
      <SessionsPanel
        sessions={[{ ...idleSession, hasActiveDeepResearch: true }]}
      />
    )
    expect(screen.queryByRole('button', { name: /stop research/i })).not.toBeInTheDocument()
  })

  test('a running research run offers a stop action that cancels the job and refetches', async () => {
    const user = userEvent.setup()
    mockListResearchRuns.mockResolvedValue({
      jobs: [
        {
          job_id: 'job-live',
          status: 'running',
          created_at: today.toISOString(),
          conversation_id: null,
          project_collection: 'proj_1',
        },
      ],
      total: 1,
    })
    render(
      <SessionsPanel
        sessions={[idleSession]}
        projectId="p1"
      />
    )

    expect(await screen.findByText('Running')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop research' }))
    expect(await screen.findByText('Stop research?')).toBeInTheDocument()
    await user.click(screen.getByTestId('stop-research-confirm'))

    await waitFor(() => {
      expect(mockCancelJob).toHaveBeenCalledWith('job-live', undefined, { projectId: 'p1' })
    })
    await waitFor(() => {
      expect(mockListResearchRuns).toHaveBeenCalledTimes(2)
    })
  })

  test('cancelling the stop confirm cancels nothing', async () => {
    const user = userEvent.setup()
    mockListResearchRuns.mockResolvedValue({
      jobs: [
        {
          job_id: 'job-live',
          status: 'running',
          created_at: today.toISOString(),
          conversation_id: null,
          project_collection: 'proj_1',
        },
      ],
      total: 1,
    })
    render(
      <SessionsPanel
        sessions={[idleSession]}
        projectId="p1"
      />
    )
    expect(await screen.findByText('Running')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop research' }))
    expect(await screen.findByText('Stop research?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(mockCancelJob).not.toHaveBeenCalled()
  })

  test('a finished research run offers no stop action', async () => {
    mockListResearchRuns.mockResolvedValue({
      jobs: [
        {
          job_id: 'job-done',
          status: 'completed',
          created_at: today.toISOString(),
          conversation_id: null,
          project_collection: 'proj_1',
        },
      ],
      total: 1,
    })
    render(
      <SessionsPanel
        sessions={[idleSession]}
        projectId="p1"
      />
    )

    expect(await screen.findByText('Report ready')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /stop research/i })).not.toBeInTheDocument()
  })
})

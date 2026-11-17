import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { SessionsPanel } from './SessionsPanel'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { LayoutStore } from '../types'
import { useLayoutStore } from '../store'
import { rowOf, setupChatStoreMock } from './sessions-panel.fixtures'

const mockSetSessionsPanelOpen = vi.fn()

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

import { render, screen } from '@/test-utils'
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

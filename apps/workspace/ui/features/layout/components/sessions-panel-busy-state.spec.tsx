import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { SessionsPanel } from './SessionsPanel'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { LayoutStore, Session } from '../types'
import { useLayoutStore } from '../store'
import { setupChatStoreMock } from './sessions-panel.fixtures'

const mockSetSessionsPanelOpen = vi.fn()

vi.mock('../store', () => ({
  useLayoutStore: vi.fn(),
}))

vi.mock('@/features/chat/store', () => ({
  useChatStore: vi.fn(),
}))

const session = (id: string, title: string, activity: Session['activity'] = null): Session => ({
  id,
  title,
  date: new Date(),
  activity,
})

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

describe('SessionsPanel - several chats at once', () => {
  test('another chat opens while one still answers', async () => {
    setupChatStoreMock({ hasAnyBusySession: () => true })
    const user = userEvent.setup()
    const onSelectSession = vi.fn()
    render(
      <SessionsPanel
        sessions={[session('session-1', 'Fluchtwege', 'working'), session('session-2', 'Stellplätze')]}
        selectedSessionId="session-1"
        onSelectSession={onSelectSession}
      />
    )

    const other = screen.getByRole('button', { name: 'Chat: Stellplätze' })
    expect(other).not.toBeDisabled()
    await user.click(other)
    expect(onSelectSession).toHaveBeenCalledWith('session-2')
  })

  test('a new chat starts while one still answers', async () => {
    setupChatStoreMock({ hasAnyBusySession: () => true })
    const user = userEvent.setup()
    const onNewSession = vi.fn()
    render(
      <SessionsPanel sessions={[session('session-1', 'Fluchtwege', 'working')]} onNewSession={onNewSession} />
    )

    const newChat = screen.getByRole('button', { name: /^start a new chat$/i })
    expect(newChat).not.toBeDisabled()
    await user.click(newChat)
    expect(onNewSession).toHaveBeenCalledOnce()
  })

  test('each row says what its chat is doing: working, waiting for an answer, answer ready', () => {
    render(
      <SessionsPanel
        sessions={[
          session('session-1', 'Fluchtwege', 'working'),
          session('session-2', 'Stellplätze', 'waiting'),
          session('session-3', 'Abstandsflächen', 'answered'),
          session('session-4', 'Brandschutz'),
        ]}
        selectedSessionId="session-4"
      />
    )

    expect(screen.getByRole('button', { name: 'Chat: Fluchtwege — Working on this chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chat: Stellplätze — Waiting for your answer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chat: Abstandsflächen — Answer ready' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chat: Brandschutz' })).toBeInTheDocument()
  })
})

describe('SessionsPanel - Delete Button States', () => {
  const sessions = [session('session-1', 'First Session', 'working'), session('session-2', 'Second Session')]

  test('a chat that still answers cannot be deleted, and says why', async () => {
    setupChatStoreMock({ hasAnyBusySession: () => true })
    const user = userEvent.setup()
    render(<SessionsPanel sessions={sessions} />)

    await user.hover(screen.getByRole('button', { name: /chat: first session/i }))

    const deleteButton = screen.getByRole('button', { name: /delete chat \(disabled\)/i })
    expect(deleteButton).toBeDisabled()
    expect(deleteButton).toHaveAttribute('title', 'Cannot delete while operations are in progress')
  })

  test('an idle chat can be deleted while another one answers', async () => {
    setupChatStoreMock({ hasAnyBusySession: () => true })
    const user = userEvent.setup()
    render(<SessionsPanel sessions={sessions} />)

    await user.hover(screen.getByRole('button', { name: /chat: second session/i }))

    expect(screen.getByRole('button', { name: /^delete chat$/i })).not.toBeDisabled()
  })

  test('disables "Delete All" button when any session is busy', () => {
    setupChatStoreMock({ hasAnyBusySession: () => true })
    render(<SessionsPanel sessions={sessions} />)

    expect(
      screen.getByRole('button', { name: /delete all chats in this project \(disabled\)/i })
    ).toBeDisabled()
  })

  test('enables "Delete All" button when no sessions are busy', () => {
    render(<SessionsPanel sessions={[session('session-2', 'Second Session')]} />)

    expect(screen.getByRole('button', { name: /^delete all chats in this project$/i })).not.toBeDisabled()
  })
})

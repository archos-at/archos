import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { ChatToolbar } from './ChatToolbar'

vi.mock('@/adapters/auth', () => ({ useAuth: () => ({ isAuthenticated: true }) }))
vi.mock('@/shared/hooks/use-connection-presence', () => ({ useConnectionPresence: () => 'connected' }))
vi.mock('../store', () => ({ useLayoutStore: (selector: (s: { toggleSessionsPanel: () => void }) => unknown) => selector({ toggleSessionsPanel: vi.fn() }) }))
vi.mock('@/features/chat/store', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({
      currentConversation: { id: 'session-1', messages: [], updatedAt: new Date('2026-11-18T09:00:00Z') },
      updateConversationTitle: vi.fn(),
    }),
}))

describe('what the header says about the chat', () => {
  test('the date of the last change stands beside the title', () => {
    render(<ChatToolbar sessionTitle="My Session" />)

    expect(screen.getByTestId('chat-changed-on')).toHaveTextContent(/^Changed .*2026$/)
  })

  test('a chat nobody else can reach says „Only you“, and the sentence behind it on a click', async () => {
    const user = userEvent.setup()
    render(<ChatToolbar sessionTitle="My Session" />)

    await user.click(screen.getByTestId('chat-only-you'))

    expect(screen.getByTestId('chat-only-you')).toHaveTextContent('Only you')
    expect(await screen.findByTestId('chat-only-you-statement')).toHaveTextContent('Only you see this chat until you share it.')
  })

  test('an empty chat says nothing yet', () => {
    render(<ChatToolbar isChatStarted={false} />)

    expect(screen.queryByTestId('chat-only-you')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-changed-on')).not.toBeInTheDocument()
  })

  test('the menu deletes the chat, after the question', async () => {
    const user = userEvent.setup()
    const onDeleteSession = vi.fn()
    render(<ChatToolbar sessionTitle="My Session" onDeleteSession={onDeleteSession} />)

    await user.click(screen.getByTestId('thread-menu'))
    await user.click(await screen.findByTestId('delete-session'))
    expect(onDeleteSession).not.toHaveBeenCalled()
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /delete/i }))

    expect(onDeleteSession).toHaveBeenCalledWith('session-1')
  })
})

import { act, render, screen } from '@/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useChatStore } from '@/features/chat/store'
import { markConversationMinted, resetConversationsOnServer } from '@/features/chat/lib/conversation-on-server'
import { resetTemporarySettling, setConversationTemporary } from '@/features/chat/lib/temporary-conversation'
import { WelcomeState } from './chat-area-states'

vi.mock('@/adapters/auth', () => ({ useAuth: () => ({ user: { name: 'Anna Berger' } }) }))

describe('WelcomeState', () => {
  test('says under the greeting who sees the chat, and nothing about what the agent writes', () => {
    render(<WelcomeState isAuthenticated />)

    expect(screen.getByRole('heading')).toHaveTextContent('Anna')
    expect(screen.getByTestId('new-chat-only-you')).toHaveTextContent('Only you see this chat.')
    expect(screen.queryByText(/drafts/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('inbound-mail-waiting-line')).not.toBeInTheDocument()
  })

  test('a temporary chat swaps the greeting for its title and what it means, in the same place', () => {
    markConversationMinted('c-1')
    const draft = { id: 'c-1', userId: 'u-1', title: '', messages: [], createdAt: new Date(), updatedAt: new Date() }
    act(() => useChatStore.setState({ currentConversation: draft, conversations: [draft] }))
    const { rerender } = render(<WelcomeState isAuthenticated />)
    expect(screen.getByTestId('new-chat-greeting')).not.toHaveAttribute('aria-hidden')
    expect(screen.getByTestId('new-chat-temporary')).toHaveAttribute('aria-hidden', 'true')

    act(() => setConversationTemporary('c-1', true))
    rerender(<WelcomeState isAuthenticated />)

    expect(screen.getByRole('heading')).toHaveTextContent('Temporary chat')
    expect(screen.getByTestId('new-chat-temporary')).toHaveTextContent('keeps nothing from it')
    expect(screen.getByTestId('new-chat-greeting')).toHaveAttribute('aria-hidden', 'true')
    for (const face of ['new-chat-greeting', 'new-chat-temporary']) {
      expect(screen.getByTestId(face)).toHaveClass('col-start-1', 'row-start-1', 'transition-opacity', 'duration-quick', 'motion-reduce:transition-none')
    }
  })
})

afterEach(() => {
  act(() => {
    resetConversationsOnServer()
    resetTemporarySettling()
    useChatStore.setState({ currentConversation: null, conversations: [] })
  })
})

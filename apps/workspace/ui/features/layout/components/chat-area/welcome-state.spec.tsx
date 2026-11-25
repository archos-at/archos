import { act, render, screen } from '@/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useChatStore } from '@/features/chat/store'
import { markConversationMinted, resetConversationsOnServer } from '@/features/chat/lib/conversation-on-server'
import { resetTemporarySettling, setConversationTemporary } from '@/features/chat/lib/temporary-conversation'
import { WelcomeState } from './chat-area-states'

const auth = { user: { name: 'Anna Berger' } as { name: string } | null, isLoading: false }
vi.mock('@/adapters/auth', () => ({ useAuth: () => auth }))

describe('WelcomeState', () => {
  test('says under the greeting who sees the chat, and nothing about what the agent writes', () => {
    render(<WelcomeState isAuthenticated />)

    expect(screen.getByRole('heading')).toHaveTextContent('Anna')
    expect(screen.getByTestId('new-chat-only-you')).toHaveTextContent('Only you see this chat.')
    expect(screen.queryByText(/drafts/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('inbound-mail-waiting-line')).not.toBeInTheDocument()
  })

  test('while the sign-in is still loading it greets, and never shows a signed-in person the sign-in prompt', () => {
    auth.user = null
    auth.isLoading = true
    render(<WelcomeState isAuthenticated={false} />)
    expect(screen.getByTestId('new-chat-greeting')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
  })

  test('holds the heading’s place unseen until the name is known, so a name arriving does not widen a heading already shown', () => {
    auth.user = null
    auth.isLoading = true
    const { rerender } = render(<WelcomeState isAuthenticated={false} />)
    expect(screen.getByTestId('new-chat-greeting').querySelector('h1')).toHaveClass('invisible')
    auth.user = { name: 'Anna Berger' }
    auth.isLoading = false
    rerender(<WelcomeState isAuthenticated />)
    expect(screen.getByTestId('new-chat-greeting').querySelector('h1')).not.toHaveClass('invisible')
    expect(screen.getByTestId('new-chat-greeting')).toHaveTextContent(/Anna/)
  })

  test('once the sign-in has settled without a person, it asks to sign in', () => {
    auth.user = null
    auth.isLoading = false
    render(<WelcomeState isAuthenticated={false} />)
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
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
  auth.user = { name: 'Anna Berger' }
  auth.isLoading = false
  act(() => {
    resetConversationsOnServer()
    resetTemporarySettling()
    useChatStore.setState({ currentConversation: null, conversations: [] })
  })
})

import { render, screen } from '@/test-utils'
import { describe, expect, test, vi } from 'vitest'
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
})

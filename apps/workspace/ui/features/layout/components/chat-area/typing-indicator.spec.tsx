import { describe, expect, test } from 'vitest'
import { render, screen } from '@/test-utils'
import { TypingIndicator } from './chat-area-states'

describe('the typing indicator arrives only with a wait the reader sees begin', () => {
  test('a wait that starts in the open thread fades in', () => {
    render(<TypingIndicator />)
    expect(screen.getByRole('status')).toHaveClass('animate-in')
  })

  test('a wait already running when the thread mounts (after a switch) is simply there', () => {
    render(<TypingIndicator arrives={false} />)
    expect(screen.getByRole('status')).not.toHaveClass('animate-in')
  })
})

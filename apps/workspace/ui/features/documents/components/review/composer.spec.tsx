import { describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/use-mentionable-people', () => ({
  useMentionablePeople: () => ({ people: [], loading: false, error: null }),
}))

import { render, screen } from '@/test-utils'
import { Composer } from './composer'

describe('the reply composer on a touch screen', () => {
  it.each([
    ['a reply that may mention the agent', { mentionAgent: true }],
    ['a reply that may ask the agent', { onAskAgent: vi.fn() }],
  ] as const)('%s: every button is a 44px square, not a catchment a short scroller clips', (_, props) => {
    render(<Composer testId="reply" placeholder="Ihre Antwort" submitLabel="Senden" onSubmit={vi.fn()} {...props} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button).toHaveClass('pointer-coarse:size-11')
      expect(button).not.toHaveClass('pointer-coarse:size-8')
    }
  })
})

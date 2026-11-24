import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@/test-utils'

const trails = vi.hoisted(() => ({ next: null as unknown }))
vi.mock('../../lib/answer-trails', () => ({ answerTrailFor: vi.fn(async () => trails.next) }))

import { AnswerTrailSection } from './answer-trail'

describe('AnswerTrailSection („Gelesen“)', () => {
  it('names the places the reader may open, withholds the rest, and says what personal context was in play', async () => {
    trails.next = {
      messageId: 'a1',
      places: [
        { kind: 'project', id: 'p1', name: 'Wohnbau Graz' },
        { kind: 'folder', withheld: true },
      ],
      personalMemory: true,
      personalShelf: true,
      solo: true,
    }
    render(<AnswerTrailSection conversationId="s_c" messageId="a1" />)

    const section = await screen.findByTestId('answer-trail')
    expect(section).toHaveTextContent('Read in')
    expect(screen.getAllByTestId('answer-trail-place').map((chip) => chip.textContent)).toEqual([
      'Wohnbau Graz',
      'A folder you may not open',
    ])
    expect(screen.getByTestId('answer-trail-personal-shelf')).toHaveTextContent('Meine Ablage')
    expect(screen.getByTestId('answer-trail-personal-memory')).toHaveTextContent('Personal memory')
  })

  it('shows nothing for an answer without a record, or one that read nothing', async () => {
    trails.next = null
    const { rerender } = render(<AnswerTrailSection conversationId="s_c" messageId="old" />)
    await waitFor(() => expect(screen.queryByTestId('answer-trail')).toBeNull())

    trails.next = { messageId: 'a2', places: [], personalMemory: false, personalShelf: false, solo: false }
    rerender(<AnswerTrailSection conversationId="s_c" messageId="a2" />)
    await waitFor(() => expect(screen.queryByTestId('answer-trail')).toBeNull())
  })
})

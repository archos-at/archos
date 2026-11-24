import { beforeEach, describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test-utils'
import { useChatStore } from '@/features/chat/store'
import { Harness, scriptedRoom, serve, view } from './review.fixtures'

const READING = {
  value: 3,
  unit: 'm',
  low: 2.98,
  high: 3.02,
  provenance: 'vector_verified',
  scaleState: 'verified',
  scaleRatio: 100,
  printed: null,
} as const

const measurement = (id: string, number: number, page: number) =>
  view({
    id,
    number,
    page,
    shape: 'line',
    kind: 'hint',
    body: 'Gangbreite',
    points: [
      [0.1, 0.1],
      [0.4, 0.1],
    ],
    reading: READING,
  })

beforeEach(() => useChatStore.setState({ currentUserId: 'user_me' }))

describe('a kept measurement is a fact on the sheet, not an open item', () => {
  it('leaves the open count alone and lists apart as a Measurement with its page', async () => {
    serve([view({ id: 'ann_1', number: 1 }), measurement('ann_m1', 2, 1), measurement('ann_m2', 3, 2)])
    render(<Harness transport={scriptedRoom().transport} />)

    const group = await screen.findByTestId('review-measurements')
    expect(screen.getByTestId('review-filter-open')).toHaveTextContent(/1$/)
    expect(screen.getAllByTestId('review-row')).toHaveLength(3)
    const rows = within(group).getAllByTestId('review-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[1]).getByTestId('mark-row-kind')).toHaveTextContent('Measurement')
    expect(within(rows[1]).getByTestId('review-row-meta')).toHaveTextContent('Page 2')
  })

  it('offers neither Zuständige nor Frist nor Erledigt on its thread, and keeps reply and delete', async () => {
    serve([measurement('ann_m1', 2, 1)])
    render(<Harness transport={scriptedRoom().transport} />)

    await userEvent.click(within(await screen.findByTestId('review-measurements')).getByTestId('review-row'))
    const card = await screen.findByTestId('review-thread')
    expect(card).toHaveTextContent('Measurement')
    expect(within(card).queryByTestId('thread-assignee')).toBeNull()
    expect(within(card).queryByTestId('thread-due')).toBeNull()
    expect(within(card).queryByTestId('thread-resolve')).toBeNull()
    expect(within(card).getByTestId('thread-reply')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: /more/i }))
    expect(await screen.findByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
  })
})

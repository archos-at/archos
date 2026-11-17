import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test-utils'

import { FeedbackTrend, FeedbackTrendDirection } from './feedback-trend'

const dayAgo = (n: number): string => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

describe('FeedbackTrend', () => {
  it('plots the RATE, so a busy day is not mistaken for a bad one', () => {
    const points = [
      { day: dayAgo(2), up: 18, down: 2 },
      { day: dayAgo(0), up: 7, down: 3 },
    ]
    render(
      <>
        <FeedbackTrend windowDays={3} points={points} />
        <FeedbackTrendDirection windowDays={3} points={points} />
      </>
    )

    expect(screen.getByTestId('feedback-trend')).toBeInTheDocument()
    expect(screen.getByTestId('feedback-trend-delta')).toHaveTextContent(/worse/i)
  })

  it('refuses to report a direction it cannot see', () => {
    render(
      <>
        <FeedbackTrend windowDays={7} points={[{ day: dayAgo(1), up: 1, down: 1 }]} />
        <FeedbackTrendDirection windowDays={7} points={[{ day: dayAgo(1), up: 1, down: 1 }]} />
      </>
    )

    expect(screen.getByTestId('feedback-trend-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('feedback-trend')).toBeNull()
    expect(screen.queryByTestId('feedback-trend-delta')).toBeNull()
  })

  it('measures direction over thirds, not over the two end days', () => {
    const points = [
      ...[9, 8, 7, 6].map((n, i) => ({ day: dayAgo(9 - i), up: 10 - n, down: n })),
      ...[3, 2, 3, 2].map((n, i) => ({ day: dayAgo(4 - i), up: 10 - n, down: n })),
      { day: dayAgo(0), up: 2, down: 8 },
    ]
    render(<FeedbackTrendDirection windowDays={10} points={points} />)

    expect(screen.getByTestId('feedback-trend-delta')).toHaveTextContent(/better/i)
  })

  it('treats a thin day as unknown rather than as a spike', () => {
    const points = [
      ...[5, 5, 5].map((n, i) => ({ day: dayAgo(5 - i), up: 15, down: n })),
      { day: dayAgo(1), up: 0, down: 1 },
      { day: dayAgo(0), up: 16, down: 4 },
    ]
    render(<FeedbackTrend windowDays={6} points={points} minVotes={5} />)

    const svg = screen.getByRole('img')
    expect(svg.querySelectorAll('circle')).toHaveLength(4)
  })

  it('draws without stretching: no squashed SVG text, aspect kept', () => {
    const points = [0, 1, 2].map((n) => ({ day: dayAgo(n), up: 8, down: 2 }))
    render(<FeedbackTrend windowDays={3} points={points} />)

    const svg = screen.getByRole('img')
    expect(svg.getAttribute('preserveAspectRatio')).toBeNull()
    expect(svg.querySelector('text')).toBeNull()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})

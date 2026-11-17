import { describe, expect, test } from 'vitest'
import { render, screen } from '@/test-utils'

import { InboxBadge } from './InboxBadge'

describe('InboxBadge', () => {
  test('renders nothing at all when nothing is pending (no empty circle)', () => {
    const { container } = render(<InboxBadge pending={0} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('inbox-badge')).not.toBeInTheDocument()
  })

  test('renders nothing for a negative or non-finite count', () => {
    expect(render(<InboxBadge pending={-3} />).container).toBeEmptyDOMElement()
    expect(render(<InboxBadge pending={Number.NaN} />).container).toBeEmptyDOMElement()
  })

  test('uses the singular aria key for exactly one item', () => {
    render(<InboxBadge pending={1} />)
    const badge = screen.getByTestId('inbox-badge')
    expect(badge).toHaveTextContent('1')
    expect(badge).toHaveAttribute('aria-label', '1 item needs your attention')
  })

  test('interpolates the count into the plural aria key', () => {
    render(<InboxBadge pending={4} />)
    const badge = screen.getByTestId('inbox-badge')
    expect(badge).toHaveTextContent('4')
    expect(badge).toHaveAttribute('aria-label', '4 items need your attention')
  })

  test('caps the visible number at 99+ but keeps the true count in the label', () => {
    render(<InboxBadge pending={128} />)
    const badge = screen.getByTestId('inbox-badge')
    expect(badge.querySelector('[aria-hidden]')).toHaveTextContent(/^99\+$/)
    expect(badge).toHaveAttribute('aria-label', '128 items need your attention')
    expect(badge).toHaveAttribute('data-pending', '128')
  })

  test('accepts positioning overrides so the collapsed rail can place it', () => {
    render(<InboxBadge pending={2} className="absolute -top-1 -right-1" />)
    expect(screen.getByTestId('inbox-badge').parentElement).toHaveClass('absolute')
  })

  test('renders through the CountPill primitive, in its attention tone', () => {
    render(<InboxBadge pending={3} />)
    const badge = screen.getByTestId('inbox-badge')
    expect(badge).toHaveAttribute('data-slot', 'count-pill')
    expect(badge).toHaveClass('bg-primary')
  })

  test('a rise replays the arrival once, and a re-render inside it does not cut it off', () => {
    const pill = (): Element => screen.getByTestId('inbox-badge').parentElement!
    const { rerender } = render(<InboxBadge pending={2} />)
    const atRest = pill()
    rerender(<InboxBadge pending={3} />)
    const arriving = pill()
    expect(arriving).not.toBe(atRest)
    rerender(<InboxBadge pending={3} />)
    expect(pill()).toBe(arriving)
    rerender(<InboxBadge pending={1} />)
    expect(pill()).toBe(arriving)
  })
})

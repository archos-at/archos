import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConnectionPresenceIndicator } from './connection-presence-indicator'

// The component always mounts the presence hook (which schedules a health
// ping). Stub fetch with a never-resolving promise so no async state update
// races the assertions; the `presence` prop overrides the detected value.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ConnectionPresenceIndicator', () => {
  it('renders the connected state as a quiet success dot with no pulse', () => {
    const { container } = render(<ConnectionPresenceIndicator presence="connected" />)

    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('data-presence', 'connected')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(container.querySelector('.bg-success')).toBeTruthy()
    // The resting state must not animate.
    expect(container.querySelector('.animate-ping')).toBeNull()
  })

  // Colour never travels alone (design-language.md, Principles 2): a state
  // that is not fine is a glyph in its colour beside its words.
  it('renders the reconnecting state as the ochre refresh glyph and its words, not a pulsing dot', () => {
    const { container } = render(<ConnectionPresenceIndicator presence="reconnecting" />)

    expect(screen.getByText('Connection interrupted')).toBeInTheDocument()
    expect(container.querySelector('svg.lucide-refresh-cw')).toHaveClass('text-warning')
    expect(container.querySelector('.animate-ping')).toBeNull()
  })

  it('renders the offline state as the red wifi-off glyph and its words', () => {
    const { container } = render(<ConnectionPresenceIndicator presence="offline" />)

    expect(screen.getByText('No connection')).toBeInTheDocument()
    expect(container.querySelector('svg.lucide-wifi-off')).toHaveClass('text-error')
    expect(container.querySelector('.bg-danger')).toBeNull()
  })

  it('hides the label in compact mode but preserves the accessible name', () => {
    render(<ConnectionPresenceIndicator presence="offline" compact />)

    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-label', 'No connection')
    expect(screen.queryByText('No connection')).toBeNull()
  })

  // Alone in the icon rail a red dot was colour carrying the meaning by itself
  // (design-language.md, Principles: colour never travels alone).
  it('in compact mode draws a glyph for a state that is not fine, not a bare dot', () => {
    const { container, rerender } = render(<ConnectionPresenceIndicator presence="offline" compact />)
    expect(container.querySelector('svg.lucide-wifi-off')).toBeTruthy()
    expect(container.querySelector('.bg-danger')).toBeNull()

    rerender(<ConnectionPresenceIndicator presence="reconnecting" compact />)
    expect(container.querySelector('svg.lucide-refresh-cw')).toBeTruthy()
  })
})

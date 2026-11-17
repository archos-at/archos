import { render, screen } from '@/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionPresence } from '@/shared/hooks/use-connection-presence'
import { ConnectionBand } from './connection-band'

let presence: ConnectionPresence = 'connected'
const requestConnectionCheck = vi.fn()
vi.mock('@/shared/hooks/use-connection-presence', () => ({
  useConnectionPresence: () => presence,
  requestConnectionCheck: () => requestConnectionCheck(),
}))

describe('ConnectionBand', () => {
  it('takes no room while connected, and stays in the tree so the change is announced', () => {
    presence = 'connected'
    const { container } = render(<ConnectionBand appearance="line" />)

    const band = container.querySelector('[data-slot="connection-band"]')
    expect(band).toHaveClass('sr-only')
    expect(band).not.toHaveClass('h-6')
  })

  it('is a thin line of text, not a bordered card, when the chat toolbar asks for the line', () => {
    presence = 'reconnecting'
    const { container } = render(<ConnectionBand appearance="line" />)

    const band = container.querySelector('[data-slot="connection-band"]')
    expect(band).toHaveClass('h-6')
    expect(band).not.toHaveClass('border-t')
    expect(band).not.toHaveClass('sr-only')
  })

  it('is a line of the header’s band by default, with no rule of its own', () => {
    presence = 'offline'
    const { container } = render(<ConnectionBand />)

    const band = container.querySelector('[data-slot="connection-band"]')
    expect(band).toHaveClass('h-7')
    expect(band).not.toHaveClass('border-t')
  })

  it('offers to try again while reconnecting, and not while offline', async () => {
    presence = 'reconnecting'
    const { rerender } = render(<ConnectionBand appearance="rail" />)
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(requestConnectionCheck).toHaveBeenCalledTimes(1)

    presence = 'offline'
    rerender(<ConnectionBand appearance="rail" />)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('is a rail row on the icons’ column while the link is gone, and nothing to the eye while it is fine', () => {
    presence = 'reconnecting'
    const { container, rerender } = render(<ConnectionBand appearance="rail" />)
    const band = (): Element => container.querySelector('[data-slot="connection-band"]')!
    expect(band()).toHaveClass('min-h-9', 'px-3')
    expect(band().querySelector('[role="status"]')).toHaveClass('gap-[11px]')

    rerender(<ConnectionBand appearance="rail" compact />)
    expect(band()).toHaveClass('size-9')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()

    presence = 'connected'
    rerender(<ConnectionBand appearance="rail" />)
    expect(band()).toHaveClass('sr-only')
    expect(band().querySelector('[role="status"]')).toBeInTheDocument()
  })
})

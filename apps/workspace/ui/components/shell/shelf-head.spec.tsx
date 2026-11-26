import type { JSX } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/projects/p1/files',
  useSearchParams: () => new URLSearchParams(),
}))

import { render, screen } from '@/test-utils'
import { ShelfHead } from './shelf-head'

const head = (phone: boolean) =>
  render(
    <ShelfHead
      crumb={['Wohnbau Nord']}
      title="Ablage"
      place={null}
      phone={phone}
      tools={<input aria-label="Suchen" data-testid="search" />}
      places={<nav data-testid="tabs" />}
    />
  )

describe('a shelf head on a phone, its places over its search', () => {
  it('keeps the places’ own height and 12px under them, so the open tab’s rule does not sit on the field', () => {
    head(true)
    expect(screen.getByTestId('shelf-head-places')).toHaveClass('phone:mb-0')
    expect(screen.getByTestId('search').closest('[data-testid="shelf-head-tools"]')?.parentElement).toHaveClass('mt-3')
  })

  it('lets the places hang onto the head’s rule where no row follows them (a desktop)', () => {
    head(false)
    expect(screen.getByTestId('shelf-head-places')).toHaveClass('-mb-4')
    expect(screen.getByTestId('shelf-head-places')).not.toHaveClass('phone:mb-0')
  })
})

describe('a shelf head whose page publishes its tools after it loads', () => {
  const pending = (tools: JSX.Element | null) =>
    render(<ShelfHead crumb={[]} title="Ablage" place={null} phone={false} tools={tools} toolsPending places={<nav data-testid="tabs" />} />)

  it('holds the phone’s tool row in CSS before the page and the phone are known, so the list does not drop when they arrive', () => {
    pending(null)
    expect(screen.getByTestId('shelf-head-tools-held')).toHaveClass('hidden', 'phone:block', 'h-11', 'mt-3')
    expect(screen.getByTestId('shelf-head-places')).toHaveClass('phone:mb-0')
  })

  it('lets the tools take the row once they are there', () => {
    pending(<input aria-label="Suchen" />)
    expect(screen.queryByTestId('shelf-head-tools-held')).toBeNull()
  })
})

import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test-utils'

vi.mock('./InboxQueue', () => ({ InboxQueue: () => <p>queue</p> }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { useStartDock } from '@/components/shell/start-dock'
import { InboxDock } from './InboxDock'

/** The door the dock was opened from: any focusable element carrying `data-dock-door`, as the rail's Postfach entry does. */
const Door = () => (
  <button type="button" data-dock-door="inbox" data-testid="door">
    Postfach
  </button>
)

afterEach(() => act(() => useStartDock.getState().close()))

describe('InboxDock — its header', () => {
  test('names the dock and carries no count: the queue heading says how many wait, once', () => {
    render(<InboxDock />)
    const header = screen.getByRole('heading', { level: 2 })
    expect(header).toHaveTextContent(/^Inbox$/)
    expect(header.closest('header')).not.toHaveTextContent(/\d/)
  })
})

// Owner decision 2026-11-12: in the desk's grey the dock ran into the rail beside it.
describe('InboxDock — a sheet of its own beside the rail', () => {
  test('is a sheet on the desk with a sheet’s one edge, its ring, and room round it', () => {
    render(<InboxDock />)
    const sheet = screen.getByTestId('inbox-dock').querySelector('[data-slot="inbox-dock-sheet"]')
    expect(sheet).toHaveClass('bg-sheet', 'shadow-sm', 'rounded-surface')
    // One edge: the shadow's ring, never a border beside it.
    expect([...(sheet?.classList ?? [])].filter((c) => /^border(-|$)/.test(c))).toEqual([])
    expect(screen.getByTestId('inbox-dock')).toHaveClass('p-2')
    // The header and the foot belong to the sheet, with the queue between them.
    expect(sheet).toContainElement(screen.getByRole('heading', { level: 2 }))
    expect(sheet).toContainElement(screen.getByTestId('inbox-dock-all'))
  })
})

describe('InboxDock — a disclosure the reader opened', () => {
  test('opened by the reader, it takes the focus so its keys work at once', () => {
    act(() => useStartDock.getState().open('inbox'))
    render(<InboxDock />)
    expect(screen.getByTestId('inbox-dock')).toHaveFocus()
    // Taken once: a later render does not pull the focus back from the page.
    expect(useStartDock.getState().takesFocus).toBe(false)
  })

  test('restored after a reload, it leaves the focus where the page has it', () => {
    window.sessionStorage.setItem('startDock.panel', 'inbox')
    act(() => useStartDock.getState().restore())
    render(<InboxDock />)
    expect(screen.getByTestId('inbox-dock')).not.toHaveFocus()
  })

  test('Escape puts it away and hands the focus back to its door', () => {
    act(() => useStartDock.getState().open('inbox'))
    render(
      <>
        <Door />
        <InboxDock />
      </>,
    )
    fireEvent.keyDown(screen.getByTestId('inbox-dock'), { key: 'Escape' })
    expect(useStartDock.getState().panel).toBeNull()
    expect(screen.getByTestId('door')).toHaveFocus()
  })
})

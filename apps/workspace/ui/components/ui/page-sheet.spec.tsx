import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { PageSheet } from './page-sheet'

function renderSheet(props: { subtitle?: string } = {}) {
  const onOpenChange = vi.fn()
  render(
    <PageSheet open onOpenChange={onOpenChange} title="Postfach" closeLabel="Schließen" {...props}>
      <p>Inhalt</p>
    </PageSheet>
  )
  return { onOpenChange }
}

describe('PageSheet', () => {
  it('shows its close on every viewport, at 44px under a finger', () => {
    renderSheet()
    const close = document.querySelector<HTMLElement>('[data-slot="page-sheet-close"]')!

    expect(close.className).not.toMatch(/(?:^|\s)hidden(?:\s|$)/)
    expect(close.className).toContain('pointer-coarse:size-11')
  })

  it('closes on a tap on the grabber’s pill', () => {
    const { onOpenChange } = renderSheet()
    const pill = document.querySelector<HTMLElement>('[data-slot="page-sheet-grabber-close"]')!

    expect(pill.className).not.toContain('pointer-events-none')
    expect(pill.className).toContain('pointer-coarse:h-11')
    fireEvent.click(pill)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('tells a bar at its foot to clear the home indicator: no tab bar runs under a sheet', () => {
    renderSheet()

    expect(screen.getByRole('dialog').className).toContain('[--shell-inset-bottom:env(safe-area-inset-bottom)]')
  })

  it('names both close controls for a screen reader', () => {
    renderSheet()

    expect(screen.getAllByRole('button', { name: 'Schließen' })).toHaveLength(2)
  })

  it('lets the subtitle wrap to two lines on a phone instead of cutting it mid-word', () => {
    renderSheet({ subtitle: 'Dokumente, die das ganze Büro teilt, unabhängig vom Projekt' })
    const subtitle = screen.getByText(/Dokumente, die das ganze Büro/)

    expect(subtitle.className).toContain('line-clamp-2')
    expect(subtitle.className).not.toMatch(/(?:^|\s)truncate(?:\s|$)/)
  })

  it('steps its content in from the Dynamic Island’s side', () => {
    renderSheet()

    expect(screen.getByRole('dialog').className).toContain('pl-[env(safe-area-inset-left)]')
    expect(screen.getByRole('dialog').className).toContain('pr-[env(safe-area-inset-right)]')
  })

  it('a window stands in the middle of the screen over a page that is dimmed, not blurred, as the concept draws it', () => {
    render(
      <PageSheet open onOpenChange={vi.fn()} title="Projektübersicht" closeLabel="Schließen" size="window">
        <p>Inhalt</p>
      </PageSheet>
    )
    const window = screen.getByRole('dialog')
    expect(window).toHaveAttribute('data-size', 'window')
    expect(window).toHaveClass('md:inset-4', 'md:m-auto', 'md:h-fit')
    expect(window.className).not.toMatch(/(?:^|\s)top-/)
    const scrim = document.querySelector<HTMLElement>('.bg-overlay')!
    expect(scrim.className).not.toContain('backdrop-blur')
  })

  it('on a phone a window is a bottom sheet like the others there: at the foot, rounded like them, with a grabber that only the phone shows', () => {
    render(
      <PageSheet open onOpenChange={vi.fn()} title="Projektübersicht" closeLabel="Schließen" size="window">
        <p>Inhalt</p>
      </PageSheet>
    )
    const window = screen.getByRole('dialog')
    expect(window).toHaveClass('inset-x-0', 'bottom-0', 'rounded-overlay', 'pb-[env(safe-area-inset-bottom)]')
    const grabber = window.querySelector('[data-slot="page-sheet-grabber"]')!
    expect(grabber).toHaveClass('md:hidden')
    expect(grabber.querySelector('[data-slot="page-sheet-grabber-close"]')).toHaveAccessibleName('Schließen')
  })
})

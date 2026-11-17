import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { ViewerProgress } from './viewer-progress'

describe('ViewerProgress', () => {
  it('reports its real position while the download has one', () => {
    render(<ViewerProgress label="Modell wird geladen" percent={42} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('claims no position at all while parsing', () => {
    render(<ViewerProgress label="Modell wird aufgebaut" percent={null} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('clamps a percentage that overshot rather than overflowing the track', () => {
    render(<ViewerProgress label="lädt" percent={140} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('names the bar with what is actually happening', () => {
    render(<ViewerProgress label="Modell wird geladen" percent={10} />)
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Modell wird geladen')
  })

  it('says what the number is OF, so a weak connection can decide to wait or stop', () => {
    render(<ViewerProgress label="lädt" percent={31} detail="37 von 120 MB" />)
    expect(screen.getByText('31% · 37 von 120 MB')).toBeInTheDocument()
  })

  it('offers a way out of the wait, and only that button takes the pointer', () => {
    const onClick = vi.fn()
    const { container } = render(
      <ViewerProgress label="lädt" percent={31} cancel={{ label: 'Abbrechen', onClick }} />
    )
    expect(container.firstElementChild?.className).toContain('pointer-events-none')
    const cancel = screen.getByRole('button', { name: 'Abbrechen' })
    expect(cancel.className).toContain('pointer-events-auto')
    fireEvent.click(cancel)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows no cancel when nothing can be cancelled', () => {
    render(<ViewerProgress label="baut auf" percent={null} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('sits below the dock and the sheets, so it can never print over one', () => {
    const { container } = render(<ViewerProgress label="lädt" percent={10} />)
    expect(container.firstElementChild?.className).toMatch(/\bz-10\b/)
    expect(container.firstElementChild?.className).not.toMatch(/\bz-30\b/)
  })
})

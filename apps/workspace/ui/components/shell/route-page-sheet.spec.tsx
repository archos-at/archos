/**
 * A route's sheet rises once.
 *
 * The route's `loading.tsx` draws `PageSheetSkeleton`, which rises as the
 * sheet. When the route resolved, the real sheet used to start again from the
 * screen's foot: two rises of one panel on every open. It now takes over where
 * the skeleton stands.
 */

import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import { PageSheetSkeleton } from './page-sheet-skeleton'
import { RoutePageSheet } from './route-page-sheet'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }))

class Matrix {
  m42: number
  constructor(transform: string) {
    this.m42 = Number(/matrix\(1, 0, 0, 1, 0, (-?[\d.]+)\)/.exec(transform)?.[1] ?? 0)
  }
}
vi.stubGlobal('DOMMatrixReadOnly', Matrix)

const panel = (): HTMLElement => document.querySelector<HTMLElement>('[role="dialog"]')!

function sheet(standalone = false) {
  return (
    <RoutePageSheet title="Postfach" closeLabel="Schließen" standalone={standalone}>
      <p>Inhalt</p>
    </RoutePageSheet>
  )
}

describe('RoutePageSheet — the entrance', () => {
  it('rises from the foot when no skeleton stood in for it', () => {
    render(sheet())
    expect(panel().style.transform).toContain('translateY(100%)')
  })

  it('takes over at rest where its skeleton stands', () => {
    const skeleton = render(<PageSheetSkeleton loadingLabel="Lädt" />)
    render(sheet())
    skeleton.unmount()
    expect(panel().style.transform).not.toContain('translateY')
  })

  it('finishes the skeleton’s rise from where it had got to', () => {
    const skeleton = render(<PageSheetSkeleton loadingLabel="Lädt" />)
    const rising = skeleton.container.querySelector<HTMLElement>('[data-slot="page-sheet-skeleton"]')!.children[1] as HTMLElement
    rising.style.transform = 'matrix(1, 0, 0, 1, 0, 240)'
    render(sheet())
    expect(panel().style.transform).toContain('translateY(240px)')
  })

  it('does not rise on a hard load', () => {
    render(sheet(true))
    expect(panel().style.transform).not.toContain('translateY')
  })
})

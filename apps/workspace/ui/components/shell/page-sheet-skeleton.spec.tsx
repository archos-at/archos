import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { PageSheetSkeleton, WINDOW_SKELETON_CARDS } from './page-sheet-skeleton'

describe('the window skeleton', () => {
  it('stands as tall as an office’s overview: three rows of cards, so the window does not jump when they load', () => {
    const { container } = render(<PageSheetSkeleton loadingLabel="Lädt" size="window" />)
    const cards = container.querySelector<HTMLElement>('[data-slot="page-sheet-skeleton-cards"]')!

    expect(WINDOW_SKELETON_CARDS).toBe(9)
    expect(cards.children).toHaveLength(WINDOW_SKELETON_CARDS)
    expect(cards).toHaveClass('sm:grid-cols-3')
  })
})

import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import { OfficeShelfPlaces, OFFICE_SHELF_FILES_HREF, OFFICE_SHELF_NORMS_HREF } from './office-shelf-places'

let pathname = OFFICE_SHELF_FILES_HREF

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}))

describe('the two places of the Büroablage', () => {
  test.each([
    [OFFICE_SHELF_FILES_HREF, 'Folders'],
    [OFFICE_SHELF_NORMS_HREF, 'Standards & guidelines'],
  ])('on %s the open place is %s', (at, open) => {
    pathname = at
    render(<OfficeShelfPlaces />)
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent(open)
  })

  test('a phone names both places, so the closed one is not a bare glyph', () => {
    pathname = OFFICE_SHELF_FILES_HREF
    render(<OfficeShelfPlaces />)
    for (const name of ['Folders', 'Standards & guidelines']) {
      expect(screen.getByText(name)).not.toHaveClass('phone:sr-only')
    }
  })
})

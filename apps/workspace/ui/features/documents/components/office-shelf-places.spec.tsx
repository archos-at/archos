import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@/test-utils'
import { OfficeShelfPlaces, OFFICE_SHELF_FILES_HREF, OFFICE_SHELF_NORMS_HREF } from './office-shelf-places'

let pathname = OFFICE_SHELF_FILES_HREF

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}))

describe('the two places of the Bürobibliothek', () => {
  test.each([
    [OFFICE_SHELF_FILES_HREF, 'Files'],
    [OFFICE_SHELF_NORMS_HREF, 'Standards & guidelines'],
  ])('on %s the open place is %s', (at, open) => {
    pathname = at
    render(<OfficeShelfPlaces />)
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent(open)
  })

  test('a phone names both places, so the closed one is not a bare glyph', () => {
    pathname = OFFICE_SHELF_FILES_HREF
    render(<OfficeShelfPlaces />)
    for (const name of ['Files', 'Standards & guidelines']) {
      expect(screen.getByText(name)).not.toHaveClass('phone:sr-only')
    }
  })

  test('says at „Normen & Richtlinien“ how many norms wait to be confirmed (KAN-86)', async () => {
    pathname = OFFICE_SHELF_FILES_HREF
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [], nextCursor: null, canManage: true, territories: [], folderCounts: {}, counts: { all: 12, proposed: 2, newerEdition: 1, checkDue: 2 } })))
    try {
      render(<OfficeShelfPlaces />)
      const norms = screen.getByRole('link', { name: /Standards & guidelines/ })
      expect(await within(norms).findByText('2')).toBeInTheDocument()
      expect(norms.querySelector('[aria-label="2 standards wait to be confirmed"]')).not.toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

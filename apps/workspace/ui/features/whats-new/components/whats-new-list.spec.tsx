import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@/test-utils'
import { WHATS_NEW_FIXTURE } from './fixtures'
import { WhatsNewList, weekTitle, whatsNewHref } from './whats-new-list'

describe('WhatsNewList', () => {
  it('offers every area that has changes, with its count, and links each to its filtered page', () => {
    render(<WhatsNewList list={WHATS_NEW_FIXTURE} />)
    const filter = screen.getByRole('navigation', { name: 'Show changes in' })
    expect(within(filter).getByRole('link', { name: 'All areas' })).toHaveAttribute('aria-current', 'page')
    expect(within(filter).getByRole('link', { name: /Search/ })).toHaveAttribute('href', '/app/whats-new?area=search')
    // An area with no changes is not offered.
    expect(within(filter).queryByRole('link', { name: /Building models/ })).toBeNull()
  })

  it('shows each week with its summary, its sections, and the fixes folded', () => {
    render(<WhatsNewList list={WHATS_NEW_FIXTURE} />)
    const week = screen.getByRole('region', { name: /2\s–\s8 November 2026/ })
    expect(within(week).getByRole('heading', { name: 'New' })).toBeInTheDocument()
    expect(within(week).getByText('1 fixes').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText(/Ctrl\+K now searches everything/)).toBeInTheDocument()
  })

  it('pages by cursor links that keep the area', () => {
    render(<WhatsNewList list={{ ...WHATS_NEW_FIXTURE, area: 'documents', cursor: '2026-W46' }} />)
    const pager = screen.getByRole('navigation', { name: 'Pages of weeks' })
    expect(within(pager).getByRole('link', { name: 'Newest weeks' })).toHaveAttribute('href', '/app/whats-new?area=documents')
    expect(within(pager).getByRole('link', { name: 'Older weeks' })).toHaveAttribute(
      'href',
      '/app/whats-new?area=documents&cursor=2026-W44',
    )
  })

  it('says so when an area had no changes in these weeks', () => {
    render(<WhatsNewList list={{ ...WHATS_NEW_FIXTURE, weeks: [], nextCursor: null }} />)
    expect(screen.getByText('Nothing has changed in this area in these weeks.')).toBeInTheDocument()
  })

  it('titles a week by its dates in the reader’s language, a version by itself', () => {
    const week = WHATS_NEW_FIXTURE.weeks[1]
    // ICU sets the range dash between thin spaces.
    expect(weekTitle(week, 'de', 'x').replace(/\s/g, ' ')).toBe('26. Oktober – 1. November 2026')
    expect(weekTitle({ ...week, kind: 'version', version: '1.2.0' }, 'en', 'x')).toBe('1.2.0')
    expect(whatsNewHref('/app/whats-new', null)).toBe('/app/whats-new')
  })
})

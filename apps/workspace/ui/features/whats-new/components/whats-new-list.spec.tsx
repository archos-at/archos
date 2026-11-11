import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@/test-utils'
import { WHATS_NEW_FIXTURE } from './fixtures'
import { WhatsNewList, groupByArea, weekTitle, whatsNewHref } from './whats-new-list'

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
    expect(within(week).getByText('1 fix').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText(/Ctrl\+K now searches everything/)).toBeInTheDocument()
  })

  it('opens the newest week of the newest page and leaves an older one behind its summary', () => {
    render(<WhatsNewList list={WHATS_NEW_FIXTURE} />)
    expect(screen.getByText('3 changes').closest('details')).toHaveAttribute('open')
    // The older week still says what it holds: its summary and its tally stay outside the fold.
    const older = screen.getByRole('region', { name: /26 October\s–\s1 November 2026/ })
    expect(within(older).getByText('2 changes').closest('details')).not.toHaveAttribute('open')
    expect(within(older).getByText(/Ctrl\+K now searches everything/).closest('details')).toBeNull()
  })

  it('opens no week by itself on an older page, and every week on a page narrowed to one area', () => {
    const { unmount } = render(<WhatsNewList list={{ ...WHATS_NEW_FIXTURE, cursor: '2026-W46' }} />)
    expect(screen.getByText('3 changes').closest('details')).not.toHaveAttribute('open')
    unmount()
    render(<WhatsNewList list={{ ...WHATS_NEW_FIXTURE, area: 'documents' }} />)
    expect(screen.getByText('2 changes').closest('details')).toHaveAttribute('open')
  })

  it('names an area once for all of its changes in a section, and not at all on a narrowed page', () => {
    const [week] = WHATS_NEW_FIXTURE.weeks
    const twoInOneArea = {
      ...WHATS_NEW_FIXTURE,
      areas: [],
      weeks: [{ ...week, notes: [...week.notes, { section: 'features', area: 'documents', text: 'A second one.' } as const] }],
    }
    const { unmount } = render(<WhatsNewList list={twoInOneArea} />)
    const added = screen.getByRole('region', { name: 'New' })
    expect(within(added).getAllByText('Files and office shelf')).toHaveLength(1)
    expect(within(added).getAllByRole('listitem')).toHaveLength(2)
    unmount()
    render(<WhatsNewList list={{ ...twoInOneArea, area: 'documents' }} />)
    expect(screen.queryByText('Files and office shelf')).toBeNull()
  })

  it('groups changes by area in the vocabulary’s order, whatever order they arrive in', () => {
    const groups = groupByArea([
      { section: 'features', area: 'general', text: 'a' },
      { section: 'features', area: 'documents', text: 'b' },
      { section: 'features', area: 'general', text: 'c' },
    ])
    expect(groups.map((group) => [group.area, group.notes.map((note) => note.text)])).toEqual([
      ['documents', ['b']],
      ['general', ['a', 'c']],
    ])
  })

  it('opens the fixes when they are all a week has', () => {
    const [week] = WHATS_NEW_FIXTURE.weeks
    const onlyFixes = { ...week, notes: week.notes.filter((note) => note.section === 'fixes') }
    render(<WhatsNewList list={{ ...WHATS_NEW_FIXTURE, area: 'documents', weeks: [onlyFixes] }} />)
    expect(screen.getByText('1 fix').closest('details')).toHaveAttribute('open')
    expect(screen.getByText('1 change')).toBeInTheDocument()
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
    expect(whatsNewHref('/dev/whats-new', 'search', null, { data: 'real' })).toBe('/dev/whats-new?data=real&area=search')
  })
})

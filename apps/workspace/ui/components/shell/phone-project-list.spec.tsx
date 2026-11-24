import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { render, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { PhoneProjectList } from './phone-project-list'
import { switcherSections as switcherSheetSections } from './project-list'
import { RECENT_PROJECTS_STORAGE_KEY, withRecentProject } from './recent-projects'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/app/projects/a/files',
}))

vi.mock('next/link', () => ({
  default: forwardRef<
    HTMLAnchorElement,
    { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>
  >(function MockLink({ href, children, ...rest }, ref) {
    return (
      <a ref={ref} href={href} {...rest}>
        {children}
      </a>
    )
  }),
}))

const PROJECTS = [
  { id: 'a', name: 'Amtshaus Favoriten' },
  { id: 'b', name: 'Bürohaus Lände' },
  { id: 'c', name: 'Grinzing Villa', status: 'closed' as const },
  { id: 'm', name: 'Volksschule Mühlgasse', status: 'paused' as const },
  { id: 's', name: 'Seestadt D12' },
]

const names = (rows: { name: string }[]): string[] => rows.map((row) => row.name)

const MANY = Array.from({ length: 9 }, (_, index) => ({ id: `p${index}`, name: `Projekt ${index}` }))

describe('switcherSheetSections', () => {
  test('recents first, in the order opened, then the rest in the order given', () => {
    const sections = switcherSheetSections(PROJECTS, 'a', ['s', 'a'], '')
    expect(sections).toEqual({
      kind: 'browse',
      shortlist: [PROJECTS[4], PROJECTS[0], PROJECTS[1], PROJECTS[3]],
      rest: [],
      all: [PROJECTS[4], PROJECTS[0], PROJECTS[1], PROJECTS[3]],
      fromRecents: false,
    })
  })

  test('a shortlist of five, never a closed or vanished project, the rest behind it', () => {
    const sections = switcherSheetSections(MANY, 'p0', ['gone', 'p8', 'p0'], '')
    if (sections.kind !== 'browse') throw new Error('expected the browse list')
    expect(sections.shortlist.map((p) => p.id)).toEqual(['p8', 'p0', 'p1', 'p2', 'p3'])
    expect(sections.rest.map((p) => p.id)).toEqual(['p4', 'p5', 'p6', 'p7'])
    const closed = switcherSheetSections(PROJECTS, 'a', ['c'], '')
    if (closed.kind !== 'browse') throw new Error('expected the browse list')
    expect(names(closed.shortlist)).not.toContain('Grinzing Villa')
  })

  test('the open project is always on the shortlist, in its last slot when it would not have made the cut', () => {
    const sections = switcherSheetSections(MANY, 'p7', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], '')
    if (sections.kind !== 'browse') throw new Error('expected the browse list')
    expect(sections.shortlist.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p7'])
    expect(sections.rest.map((p) => p.id)).toEqual(['p5', 'p6', 'p0', 'p8'])
  })

  test('without recents the shortlist is the first five as given, and says it is not from recents', () => {
    const sections = switcherSheetSections(MANY, undefined, [], '')
    if (sections.kind !== 'browse') throw new Error('expected the browse list')
    expect(sections.shortlist.map((p) => p.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
    expect(sections.fromRecents).toBe(false)
  })

  test('a query searches every project, the ones behind the shortlist included', () => {
    expect(switcherSheetSections(MANY, 'p0', [], 'projekt 8')).toEqual({ kind: 'search', matches: [MANY[8]] })
  })

  test('a query folds case and diacritics into one list of matches', () => {
    expect(switcherSheetSections(PROJECTS, 'a', ['s'], 'muhl')).toEqual({
      kind: 'search',
      matches: [PROJECTS[3]],
    })
    expect(switcherSheetSections(PROJECTS, 'a', [], '  BÜRO ')).toEqual({
      kind: 'search',
      matches: [PROJECTS[1]],
    })
  })

  test('the closed project stays offered only while it is the one open', () => {
    const sections = switcherSheetSections(PROJECTS, 'c', [], 'grinzing')
    expect(sections).toEqual({ kind: 'search', matches: [PROJECTS[2]] })
    expect(switcherSheetSections(PROJECTS, 'a', [], 'grinzing')).toEqual({
      kind: 'search',
      matches: [],
    })
  })
})

describe('withRecentProject', () => {
  test('moves a project to the front and keeps the list short', () => {
    expect(withRecentProject(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(withRecentProject(['1', '2', '3', '4', '5', '6', '7', '8'], '9')).toHaveLength(8)
  })
})

describe('PhoneProjectList', () => {
  const onDone = vi.fn()
  beforeEach(() => {
    window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(['b', 'a']))
  })
  afterEach(() => {
    window.localStorage.removeItem(RECENT_PROJECTS_STORAGE_KEY)
    onDone.mockClear()
    push.mockClear()
  })

  const open = (): HTMLElement => {
    const { container } = render(<PhoneProjectList projects={PROJECTS} activeProjectId="a" onDone={onDone} />)
    return container.querySelector<HTMLElement>('[data-slot="phone-project-list"]')!
  }

  test('lists the recents on top, by name alone, in 56px rows; „Recently opened“ only when all of them are', () => {
    const list = open()
    const recent = within(list).getByRole('region', { name: 'Projects' })
    const rows = within(recent).getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual([
      'Bürohaus Lände',
      'Amtshaus Favoriten',
      'Volksschule MühlgassePaused',
      'Seestadt D12',
    ])
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    for (const row of rows) expect(row.className).toContain('min-h-14')
    expect(within(list).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/app/projects')
  })

  test('does not raise the keyboard: the field waits for a tap', () => {
    const list = open()
    expect(within(list).getByRole('searchbox', { name: 'Search projects' })).not.toHaveFocus()
  })

  test('choosing a project goes to its chat and closes the sheet that holds the list', async () => {
    const user = userEvent.setup()
    const list = open()
    await user.click(within(list).getByRole('button', { name: 'Bürohaus Lände' }))
    expect(push).toHaveBeenCalledWith('/app/projects/b/chat')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  test('choosing the project already open only closes the sheet', async () => {
    const user = userEvent.setup()
    const list = open()
    await user.click(within(list).getByRole('button', { name: 'Amtshaus Favoriten' }))
    expect(push).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  test('typing narrows to matches, and says so when nothing matches', async () => {
    const user = userEvent.setup()
    const list = open()
    const field = within(list).getByRole('searchbox', { name: 'Search projects' })
    await user.type(field, 'seestadt')
    expect(within(within(list).getByRole('list', { name: 'Matching projects' })).getAllByRole('button')).toHaveLength(1)
    await user.clear(field)
    await user.type(field, 'zzz')
    expect(within(list).getByText('No running project has that name.')).toBeInTheDocument()
  })

  test('five rows, then one row that unfolds the rest in place, and the search still finds those', async () => {
    const user = userEvent.setup()
    const { container } = render(<PhoneProjectList projects={MANY} activeProjectId="p0" onDone={onDone} />)
    const list = container.querySelector<HTMLElement>('[data-slot="phone-project-list"]')!
    expect(within(list).getAllByRole('button', { name: /^Projekt/ })).toHaveLength(5)
    const more = within(list).getByRole('button', { name: /Show all projects/ })
    expect(more).toHaveTextContent('4')
    expect(more.className).toContain('min-h-14')
    await user.click(more)
    expect(within(list).getAllByRole('button', { name: /^Projekt/ })).toHaveLength(9)
    expect(within(list).getByRole('region', { name: 'Other projects' })).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: /Show all projects/ })).toBeNull()
    await user.type(within(list).getByRole('searchbox', { name: 'Search projects' }), 'projekt 8')
    expect(within(list).getAllByRole('button', { name: /^Projekt/ }).map((row) => row.textContent)).toEqual(['Projekt 8'])
  })

  test('unfolding the rest hands the focus to the first project it shows', async () => {
    const user = userEvent.setup()
    const { container } = render(<PhoneProjectList projects={MANY} activeProjectId="p0" onDone={onDone} />)
    const list = container.querySelector<HTMLElement>('[data-slot="phone-project-list"]')!
    await user.click(within(list).getByRole('button', { name: /Show all projects/ }))
    await vi.waitFor(() => expect(within(list).getByRole('button', { name: 'Projekt 5' })).toHaveFocus())
  })

  test('every row carries a 44px gear to that project’s settings, which closes the sheet', async () => {
    const user = userEvent.setup()
    const list = open()
    const gear = within(list).getByRole('link', { name: 'Project settings of Bürohaus Lände' })
    expect(gear).toHaveAttribute('href', '/app/projects/b/settings')
    expect(gear).toHaveClass('size-11')
    await user.click(gear)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  test('five projects opened here are „Recently opened“', () => {
    window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(['p4', 'p3', 'p2', 'p1', 'p0']))
    const { container } = render(<PhoneProjectList projects={MANY} activeProjectId="p0" onDone={onDone} />)
    const list = container.querySelector<HTMLElement>('[data-slot="phone-project-list"]')!
    expect(within(list).getByRole('region', { name: 'Recently opened' })).toBeInTheDocument()
  })

  test('ends in the two ways out the desktop menu has: the overview, and a new project', async () => {
    const user = userEvent.setup()
    const list = open()
    expect(within(list).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/app/projects')
    const create = within(list).getByRole('link', { name: 'New project' })
    expect(create).toHaveAttribute('href', '/app/projects?new=1')
    expect(create.className).toContain('min-h-14')
    await user.click(create)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

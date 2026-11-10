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

describe('switcherSheetSections', () => {
  test('recents first, in the order opened, then every other running project', () => {
    const sections = switcherSheetSections(PROJECTS, 'a', ['s', 'a'], '')
    expect(sections).toEqual({
      kind: 'browse',
      recent: [PROJECTS[4], PROJECTS[0]],
      rest: [PROJECTS[1], PROJECTS[3]],
    })
  })

  test('at most three recents, and never a closed or vanished project among them', () => {
    const sections = switcherSheetSections(PROJECTS, 'a', ['gone', 'c', 'b', 's', 'm', 'a'], '')
    if (sections.kind !== 'browse') throw new Error('expected the browse list')
    expect(names(sections.recent)).toEqual([
      'Bürohaus Lände',
      'Seestadt D12',
      'Volksschule Mühlgasse',
    ])
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

  test('lists the recents on top, by name alone, in 56px rows', () => {
    const list = open()
    const recent = within(list).getByRole('region', { name: 'Recently opened' })
    const rows = within(recent).getAllByRole('button')
    // A row is the project's name alone: initials beside a name say nothing
    // the name does not (they stand only in the icon rail, where no name fits).
    expect(rows.map((row) => row.textContent)).toEqual(['Bürohaus Lände', 'Amtshaus Favoriten'])
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    for (const row of rows) expect(row.className).toContain('min-h-14')
    expect(within(list).getByRole('link', { name: 'View all projects' })).toHaveAttribute('href', '/app/projects')
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
})

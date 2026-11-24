import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n'
import { ProjectSwitcher } from './project-switcher'
import { RECENT_PROJECTS_STORAGE_KEY } from './recent-projects'
import { useProjectOverview } from './project-overview-entry'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const PROJECTS = [
  { id: 'p-1', name: 'Wohnbau Seestadt Baufeld D12' },
  { id: 'p-2', name: 'Sanierung Amtshaus Favoriten' },
]

const show = (collapsed = false) =>
  render(
    <I18nProvider initialLocale="en" fixedLocale>
      <TooltipProvider>
        <ProjectSwitcher projects={PROJECTS} activeProjectId="p-1" collapsed={collapsed} />
      </TooltipProvider>
    </I18nProvider>
  )

const selector = (): HTMLElement => document.querySelector<HTMLElement>('[data-project-selector]')!

describe('the project selector is one press', () => {
  test('expanded: the kit’s press across the column, the name on one line, no initials', () => {
    show()
    expect(selector().tagName).toBe('BUTTON')
    expect(selector()).toHaveClass('bg-sheet', 'shadow-press', 'h-10', 'w-full')
    const name = selector().querySelector('.whitespace-nowrap')!
    expect(name).toHaveAttribute('title', 'Wohnbau Seestadt Baufeld D12')
    expect(name).toHaveClass('text-[13px]', 'font-medium')
    expect(selector().innerHTML).not.toMatch(/line-clamp/)
    expect(selector().querySelector('[data-slot="project-initials"]')).toBeNull()
  })

  test('icon rail: the same press as a 36px tile of the initials, the one place they stand', () => {
    show(true)
    expect(selector()).toHaveClass('bg-sheet', 'shadow-press', 'size-9')
    expect(selector().querySelector('[data-slot="project-initials"]')).toHaveTextContent('WS')
    expect(selector()).toHaveAccessibleName(/Wohnbau Seestadt Baufeld D12/)
  })

  test('opens the concept’s menu: a search, one list „Projects“, the current one checked, 320px wide', async () => {
    const user = userEvent.setup()
    show()
    await user.click(selector())
    const menu = await screen.findByTestId('project-switcher-menu')
    expect(menu).toHaveClass('w-80')
    expect(within(menu).getByRole('combobox')).toHaveFocus()
    expect(within(menu).getAllByRole('group')).toHaveLength(1)
    expect(within(menu).getByText('Projects')).toBeInTheDocument()
    const options = within(menu).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Wohnbau Seestadt Baufeld D12', 'Sanierung Amtshaus Favoriten'])
    expect(within(menu).queryByTestId('project-switcher-show-all')).not.toBeInTheDocument()
  })

  test('ends under a rule in two equal buttons: the overview of every project, and a new one', async () => {
    const user = userEvent.setup()
    show()
    await user.click(selector())
    const overview = await screen.findByRole('button', { name: 'Overview' })
    const create = screen.getByRole('button', { name: 'New project' })
    expect(overview.parentElement).toBe(create.parentElement)
    expect(overview.parentElement).toHaveClass('grid-cols-2')
    await user.click(overview)
    expect(useProjectOverview.getState()).toMatchObject({ open: true, create: false, returnFocus: selector() })
    await user.click(selector())
    await user.click(await screen.findByRole('button', { name: 'New project' }))
    expect(useProjectOverview.getState()).toMatchObject({ open: true, create: true })
    expect(push).not.toHaveBeenCalled()
    useProjectOverview.getState().setOpen(false)
  })

  test('choosing the current project only closes the menu; its gear alone opens the project settings', async () => {
    const user = userEvent.setup()
    show()
    push.mockClear()
    await user.click(selector())
    const gear = await screen.findByRole('link', { name: 'Project settings of Wohnbau Seestadt Baufeld D12' })
    expect(gear).toHaveAttribute('href', '/app/projects/p-1/settings')
    expect(gear).toHaveAttribute('title', 'Project settings')
    expect(within(screen.getByRole('option', { name: /Wohnbau Seestadt/ })).getByRole('link')).toBe(gear)
    await user.click(screen.getByRole('option', { name: /Wohnbau Seestadt/ }))
    expect(push).not.toHaveBeenCalled()
    expect(screen.queryByTestId('project-switcher-menu')).not.toBeInTheDocument()
    await user.click(selector())
    await user.click(await screen.findByRole('option', { name: 'Sanierung Amtshaus Favoriten' }))
    expect(push).toHaveBeenLastCalledWith('/app/projects/p-2/chat')
  })

  test('Enter on the gear opens the project settings, never the project under cmdk’s cursor; the gear is a full touch target', async () => {
    const user = userEvent.setup()
    show()
    push.mockClear()
    await user.click(selector())
    const gear = await screen.findByRole('link', { name: 'Project settings of Wohnbau Seestadt Baufeld D12' })
    expect(gear).toHaveClass('pointer-coarse:size-11')
    gear.focus()
    await user.keyboard('{ArrowDown}')
    gear.focus()
    await user.keyboard('{Enter}')
    expect(push).not.toHaveBeenCalledWith('/app/projects/p-2/chat')
  })

  test('opens with the keyboard in the list: ArrowDown and Enter switch the project', async () => {
    push.mockClear()
    const user = userEvent.setup()
    show()
    selector().focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByTestId('project-switcher-menu')
    expect(within(menu).getByTestId('project-switcher-overview')).not.toHaveFocus()

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(push).toHaveBeenCalledWith('/app/projects/p-2/chat')
  })

  test('a row is a full touch target on a coarse pointer, as tall as its gear', async () => {
    const user = userEvent.setup()
    show()
    await user.click(selector())
    const menu = await screen.findByTestId('project-switcher-menu')
    for (const option of within(menu).getAllByRole('option')) expect(option).toHaveClass('pointer-coarse:h-11')
  })

  test('every row carries its gear to the project settings, not only the current one', async () => {
    const user = userEvent.setup()
    show()
    await user.click(selector())
    const other = await screen.findByRole('link', { name: 'Project settings of Sanierung Amtshaus Favoriten' })
    expect(other).toHaveAttribute('href', '/app/projects/p-2/settings')
    expect(other).toHaveClass('hidden', 'group-data-[selected=true]:inline-flex', 'pointer-coarse:inline-flex')
    expect(other).toHaveAttribute('tabindex', '-1')
  })
})

const MANY = Array.from({ length: 9 }, (_, index) => ({ id: `m-${index}`, name: `Projekt ${index}` }))

describe('the project selector lists the projects last worked in', () => {
  const showMany = (activeProjectId: string) =>
    render(
      <I18nProvider initialLocale="en" fixedLocale>
        <TooltipProvider>
          <ProjectSwitcher projects={MANY} activeProjectId={activeProjectId} />
        </TooltipProvider>
      </I18nProvider>
    )
  const projectOptions = (menu: HTMLElement): string[] =>
    within(menu)
      .getAllByRole('option')
      .filter((option) => option.dataset.testid !== 'project-switcher-show-all')
      .map((option) => option.textContent ?? '')

  beforeEach(() => window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(['m-6', 'm-2'])))
  afterEach(() => window.localStorage.removeItem(RECENT_PROJECTS_STORAGE_KEY))

  test('five at most, the recents first, then the given order', async () => {
    const user = userEvent.setup()
    showMany('m-2')
    await user.click(selector())
    const menu = await screen.findByTestId('project-switcher-menu')
    expect(projectOptions(menu)).toEqual(['Projekt 6', 'Projekt 2', 'Projekt 0', 'Projekt 1', 'Projekt 3'])
    expect(within(menu).getByTestId('project-switcher-show-all')).toHaveTextContent('Show all projects4')
  })

  test('keeps the current project in the list when it was opened long ago', async () => {
    const user = userEvent.setup()
    showMany('m-8')
    await user.click(selector())
    const menu = await screen.findByTestId('project-switcher-menu')
    expect(projectOptions(menu)).toEqual(['Projekt 6', 'Projekt 2', 'Projekt 0', 'Projekt 1', 'Projekt 8'])
  })

  test('the last row unfolds every project in place, from the keyboard too, the cursor on the first new one', async () => {
    push.mockClear()
    const user = userEvent.setup()
    showMany('m-2')
    await user.click(selector())
    const menu = await screen.findByTestId('project-switcher-menu')
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    expect(projectOptions(menu)).toHaveLength(9)
    expect(within(menu).queryByTestId('project-switcher-show-all')).not.toBeInTheDocument()
    expect(within(menu).getByRole('option', { name: /Projekt 4/ })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(push).toHaveBeenLastCalledWith('/app/projects/m-4/chat')
  })

  test('the search reaches every project, the ones behind the five included', async () => {
    push.mockClear()
    const user = userEvent.setup()
    showMany('m-2')
    await user.click(selector())
    const menu = await screen.findByTestId('project-switcher-menu')
    await user.keyboard('projekt 7')
    expect(projectOptions(menu)).toEqual(['Projekt 7'])
    await user.keyboard('{Enter}')
    expect(push).toHaveBeenLastCalledWith('/app/projects/m-7/chat')
    await user.click(selector())
    await user.keyboard('zzz')
    expect(within(await screen.findByTestId('project-switcher-menu')).getByTestId('project-switcher-no-match')).toBeInTheDocument()
  })

  test('an office with no project to offer says nothing about a name nobody typed', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider initialLocale="en" fixedLocale>
        <TooltipProvider>
          <ProjectSwitcher projects={[]} />
        </TooltipProvider>
      </I18nProvider>
    )
    await user.click(selector())
    const menu = await screen.findByTestId('project-switcher-menu')
    expect(within(menu).queryByTestId('project-switcher-no-match')).not.toBeInTheDocument()
    expect(within(menu).queryByTestId('project-switcher-show-all')).not.toBeInTheDocument()
  })

  test('unfolded, the list is in the order worked in, the current project back in its place', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(['m-6', 'm-2']))
    showMany('m-8')
    await user.click(selector())
    const menu = await screen.findByTestId('project-switcher-menu')
    await user.click(within(menu).getByTestId('project-switcher-show-all'))
    expect(projectOptions(menu)).toEqual(['6', '2', '0', '1', '3', '4', '5', '7', '8'].map((n) => `Projekt ${n}`))
  })
})

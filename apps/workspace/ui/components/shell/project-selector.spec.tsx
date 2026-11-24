import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n'
import { ProjectSwitcher } from './project-switcher'

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

  test('opens the concept’s menu: one list „Projects“, no search, the current one checked, 320px wide', async () => {
    const user = userEvent.setup()
    show()
    await user.click(selector())
    const menu = await screen.findByTestId('project-switcher-menu')
    expect(menu).toHaveClass('w-80')
    expect(within(menu).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(menu).getAllByRole('group')).toHaveLength(1)
    expect(within(menu).getByText('Projects')).toBeInTheDocument()
    const options = within(menu).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Wohnbau Seestadt Baufeld D12', 'Sanierung Amtshaus Favoriten'])
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
    expect(push).toHaveBeenLastCalledWith('/app/projects')
    await user.click(selector())
    await user.click(await screen.findByRole('button', { name: 'New project' }))
    expect(push).toHaveBeenLastCalledWith('/app/projects?new=1')
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
})

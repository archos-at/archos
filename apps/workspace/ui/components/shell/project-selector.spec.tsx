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

  test('opens the list under it: a search, the projects by name alone, the current one checked', async () => {
    const user = userEvent.setup()
    show()
    await user.click(selector())
    const list = await screen.findByRole('listbox')
    const options = within(list).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Wohnbau Seestadt Baufeld D12',
      'Sanierung Amtshaus Favoriten',
      'Overview',
      'New project',
    ])
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  test('ends in the concept’s two rows: the overview of every project, and a new one', async () => {
    const user = userEvent.setup()
    show()
    await user.click(selector())
    await user.click(await screen.findByRole('option', { name: 'Overview' }))
    expect(push).toHaveBeenLastCalledWith('/app/projects')
    await user.click(selector())
    await user.click(await screen.findByRole('option', { name: 'New project' }))
    expect(push).toHaveBeenLastCalledWith('/app/projects?new=1')
  })

  test('reaches the current project’s own Übersicht from its row: the gear, or choosing the row itself', async () => {
    const user = userEvent.setup()
    show()
    await user.click(selector())
    const hub = await screen.findByRole('link', { name: 'Settings for Wohnbau Seestadt Baufeld D12' })
    expect(hub).toHaveAttribute('href', '/app/projects/p-1/settings')
    expect(within(screen.getByRole('option', { name: /Wohnbau Seestadt/ })).getByRole('link')).toBe(hub)
    await user.click(screen.getByRole('option', { name: /Wohnbau Seestadt/ }))
    expect(push).toHaveBeenLastCalledWith('/app/projects/p-1/settings')
    await user.click(selector())
    await user.click(await screen.findByRole('option', { name: 'Sanierung Amtshaus Favoriten' }))
    expect(push).toHaveBeenLastCalledWith('/app/projects/p-2/chat')
  })
})

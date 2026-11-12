/**
 * The project selector, the rail's first control (design-language.md, „The app
 * rail“). The founder's verdict on the version before (2026-11-10): „I really
 * hate what the sidebar does to the project selector“. It was a 24px tile of
 * initials beside the name wrapped on two lines, with no box round them:
 * nothing that read as a control.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n'
import { ProjectSwitcher } from './project-switcher'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

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
    // The kit's secondary press: white with its edge (Paper on a desk, principle 4).
    expect(selector()).toHaveClass('bg-sheet', 'shadow-press', 'h-10', 'w-full')
    // One line that loses its middle and keeps its end; the whole name is its title.
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
    // No name fits, so the accessible name carries it.
    expect(selector()).toHaveAccessibleName(/Wohnbau Seestadt Baufeld D12/)
  })

  test('opens the list under it: a search, the projects by name alone, the current one checked', async () => {
    const user = userEvent.setup()
    show()
    await user.click(selector())
    const list = await screen.findByRole('listbox')
    const options = within(list).getAllByRole('option')
    // A row is a name: no initials beside it.
    expect(options.map((option) => option.textContent)).toEqual([
      'Wohnbau Seestadt Baufeld D12',
      'Sanierung Amtshaus Favoriten',
      'View all projects',
    ])
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})

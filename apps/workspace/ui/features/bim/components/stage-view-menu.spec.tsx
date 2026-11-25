import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StageViewMenu } from './stage-view-menu'

function menu(overrides: Partial<Parameters<typeof StageViewMenu>[0]> = {}) {
  const props = {
    view: 'iso' as const,
    orthographic: false,
    onViewChange: vi.fn(),
    onOrthographicChange: vi.fn(),
    disabled: false,
    ...overrides,
  }
  render(<StageViewMenu {...props} />)
  return props
}

describe('StageViewMenu', () => {
  it('is a menu the keyboard can walk with the arrow keys', async () => {
    const user = userEvent.setup()
    const props = menu()
    await user.click(screen.getByRole('button', { name: 'View' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(props.onViewChange).toHaveBeenCalledTimes(1)
  })

  it('marks the current view as the checked radio item', async () => {
    const user = userEvent.setup()
    menu({ view: 'north' })
    await user.click(screen.getByRole('button', { name: 'View' }))
    expect(await screen.findByRole('menuitemradio', { name: 'North' })).toHaveAttribute('aria-checked', 'true')
  })

  it('toggles parallel projection without closing the menu', async () => {
    const user = userEvent.setup()
    const props = menu()
    await user.click(screen.getByRole('button', { name: 'View' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Parallel' }))
    expect(props.onOrthographicChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Home } from 'lucide-react'
import { ViewerIconButton, ViewerIconButtonBase } from './viewer-icon-button'

describe('ViewerIconButton', () => {
  it('gives an icon-only control a name a screen reader can read', () => {
    render(<ViewerIconButton label="Ganzes Modell zeigen" icon={Home} />)
    expect(screen.getByRole('button')).toHaveAccessibleName('Ganzes Modell zeigen')
  })

  it('reports pressed state when it is a toggle', () => {
    const { rerender } = render(<ViewerIconButton label="Durchsichtig" icon={Home} active={false} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
    rerender(<ViewerIconButton label="Durchsichtig" icon={Home} active />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('claims no state when it is an action', () => {
    render(<ViewerIconButton label="Ganzes Modell zeigen" icon={Home} />)
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed')
  })

  it('runs its action on click and not while disabled', async () => {
    const onClick = vi.fn()
    const { rerender } = render(<ViewerIconButton label="Schnitt" icon={Home} onClick={onClick} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(<ViewerIconButton label="Schnitt" icon={Home} onClick={onClick} disabled />)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('carries the same label as a long-press title for touch', () => {
    render(<ViewerIconButton label="Ebenen" icon={Home} />)
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Ebenen')
  })
})

describe('ViewerIconButtonBase', () => {
  it('forwards the props a Radix trigger needs to drive it', async () => {
    const onClick = vi.fn()
    render(
      <ViewerIconButtonBase
        label="Ansicht"
        icon={Home}
        onClick={onClick}
        aria-expanded={false}
        aria-haspopup="dialog"
        data-state="closed"
      />
    )
    const button = screen.getByRole('button', { name: 'Ansicht' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button).toHaveAttribute('data-state', 'closed')

    button.focus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

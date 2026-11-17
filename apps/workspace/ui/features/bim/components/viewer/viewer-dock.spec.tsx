import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Home } from 'lucide-react'
import { ViewerDock } from './viewer-dock'
import { ViewerIconButton } from './viewer-icon-button'

describe('ViewerDock', () => {
  it('keeps the empty space around the pills out of the pointer’s way', () => {
    const { container } = render(
      <ViewerDock>
        <ViewerIconButton label="Ebenen" icon={Home} />
      </ViewerDock>
    )
    const wrapper = container.firstElementChild
    expect(wrapper?.className).toContain('pointer-events-none')
    expect(screen.getByRole('button', { name: 'Ebenen' }).closest('.pointer-events-auto')).not.toBeNull()
  })

  it('sets the lead control apart in its own pill', () => {
    const { container } = render(
      <ViewerDock lead={<ViewerIconButton label="Ganzes Modell" icon={Home} />}>
        <ViewerIconButton label="Ebenen" icon={Home} />
      </ViewerDock>
    )
    expect(container.querySelectorAll('[data-slot="viewer-surface"]')).toHaveLength(2)
  })

  it('keeps the way out inside the tool pill, behind a divider', () => {
    const { container } = render(
      <ViewerDock
        lead={<ViewerIconButton label="Ganzes Modell" icon={Home} />}
        trail={<ViewerIconButton label="Mehr" icon={Home} />}
      >
        <ViewerIconButton label="Ebenen" icon={Home} />
      </ViewerDock>
    )
    expect(container.querySelectorAll('[data-slot="viewer-surface"]')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Mehr' })).toBeInTheDocument()
  })

  it('renders the section slider above the bar rather than inside it', () => {
    render(
      <ViewerDock above={<div data-testid="cut-slider" />}>
        <ViewerIconButton label="Ebenen" icon={Home} />
      </ViewerDock>
    )
    expect(screen.getByTestId('cut-slider')).toBeInTheDocument()
  })

  describe('on a phone', () => {
    it('lays the tools out as one full-width bar that does not scroll', () => {
      const { container } = render(
        <ViewerDock layout="bar">
          <ViewerIconButton label="Schnitt" icon={Home} />
          <ViewerIconButton label="Messen" icon={Home} />
        </ViewerDock>
      )
      const bar = container.querySelector('[data-slot="viewer-dock-bar"]')
      expect(bar).not.toBeNull()
      expect(bar?.className).toContain('w-full')
      expect(container.innerHTML).not.toContain('overflow-x-auto')
      expect(bar?.closest('.pointer-events-none')).not.toBeNull()
      expect(bar?.className).toContain('pointer-events-auto')
    })

    it('ignores lead and trail: what is not a tool belongs in a sheet, not in a second pill', () => {
      const { container } = render(
        <ViewerDock
          layout="bar"
          lead={<ViewerIconButton label="Zurück" icon={Home} />}
          trail={<ViewerIconButton label="Mehr" icon={Home} />}
        >
          <ViewerIconButton label="Schnitt" icon={Home} />
        </ViewerDock>
      )
      expect(screen.queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Mehr' })).not.toBeInTheDocument()
      expect(container.querySelectorAll('[data-slot="viewer-dock-bar"]')).toHaveLength(1)
      expect(container.querySelectorAll('[data-slot="viewer-surface"]')).toHaveLength(0)
    })

    it('seats the sheet in the SAME column as the bar and the rows above it', () => {
      render(
        <ViewerDock
          layout="bar"
          above={<div data-testid="above" />}
          sheet={<div data-testid="sheet" />}
        >
          <ViewerIconButton label="Schnitt" icon={Home} />
        </ViewerDock>
      )
      const column = screen.getByTestId('sheet').parentElement
      expect(column).toBe(screen.getByTestId('above').parentElement)
      expect(column).toBe(screen.getByRole('button', { name: 'Schnitt' }).closest('[data-slot="viewer-dock-bar"]')?.parentElement)
      const order = [...(column?.children ?? [])].map((child) => child.getAttribute('data-testid') ?? 'bar')
      expect(order).toEqual(['above', 'sheet', 'bar'])
    })

    it('turns the tools into a column on the left edge when the phone is on its side', () => {
      const { container } = render(
        <ViewerDock layout="side" sheet={<div data-testid="sheet" />}>
          <ViewerIconButton label="Schnitt" icon={Home} />
        </ViewerDock>
      )
      const column = container.querySelector('[data-slot="viewer-dock-column"]')
      expect(column?.className).toContain('flex-col')
      expect(column?.parentElement?.className).toContain('left-3')
      expect(container.querySelector('[data-slot="viewer-dock-bar"]')).toBeNull()
    })
  })
})

import { useEffect } from 'react'
import { render, screen, fireEvent } from '@/test-utils'
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { Sidebar, SidebarProvider, SidebarRail, useSidebar } from './sidebar'

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => mobile.value }))

const WIDTH_KEY = 'sidebar.width'
const COLLAPSED_KEY = 'sidebar.collapsed'

function Fixture(): React.JSX.Element {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  )
}

function rail(): HTMLElement {
  return screen.getByRole('separator', { name: 'Resize sidebar' })
}

function wrapper(): HTMLElement {
  return document.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement
}

function publishedWidth(): string {
  return wrapper().style.getPropertyValue('--sidebar-width')
}

function sidebarState(): string | null {
  return document.querySelector('[data-slot="sidebar"]')!.getAttribute('data-state')
}

function drag(from: number, to: number): void {
  fireEvent.pointerDown(rail(), { button: 0, clientX: from })
  fireEvent.pointerMove(window, { clientX: to })
  fireEvent.pointerUp(window, { clientX: to })
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('SidebarRail - pointer', () => {
  test('drags the rail to a new width and publishes it', () => {
    render(<Fixture />)
    expect(publishedWidth()).toBe('272px')

    drag(272, 352)

    expect(publishedWidth()).toBe('352px')
  })

  test('persists the dragged width, so the next session opens at it', () => {
    render(<Fixture />)

    drag(272, 352)

    expect(window.localStorage.getItem(WIDTH_KEY)).toBe('352')
  })

  test('restores the persisted width on mount', () => {
    window.localStorage.setItem(WIDTH_KEY, '340')

    render(<Fixture />)

    expect(publishedWidth()).toBe('340px')
  })

  test('refuses a stored width that is not a usable number', () => {
    window.localStorage.setItem(WIDTH_KEY, 'wide-ish')

    render(<Fixture />)

    expect(publishedWidth()).toBe('272px')
  })

  test('treats a cleared key as no stored width, not as zero', () => {
    window.localStorage.setItem(WIDTH_KEY, '')

    render(<Fixture />)

    expect(publishedWidth()).toBe('272px')
  })

  test('clamps a stored width into the bounds', () => {
    window.localStorage.setItem(WIDTH_KEY, '9000')

    render(<Fixture />)

    expect(publishedWidth()).toBe('420px')
  })

  test('clamps the drag at both bounds', () => {
    render(<Fixture />)

    drag(272, 900)
    expect(publishedWidth()).toBe('420px')

    drag(420, 405)
    expect(publishedWidth()).toBe('405px')

    drag(405, 380)
    expect(publishedWidth()).toBe('380px')
  })

  test('collapses when the drag goes past the floor, keeping the width it had', () => {
    render(<Fixture />)
    drag(272, 300)

    fireEvent.pointerDown(rail(), { button: 0, clientX: 300 })
    fireEvent.pointerMove(window, { clientX: 120 })

    expect(sidebarState()).toBe('collapsed')

    fireEvent.pointerMove(window, { clientX: 260 })
    fireEvent.pointerUp(window, { clientX: 260 })

    expect(sidebarState()).toBe('expanded')
    expect(publishedWidth()).toBe('260px')
  })

  test('drags the collapsed rail back out from the icon column', () => {
    window.localStorage.setItem(COLLAPSED_KEY, 'true')
    render(<Fixture />)
    expect(sidebarState()).toBe('collapsed')

    fireEvent.pointerDown(rail(), { button: 0, clientX: 64 })
    fireEvent.pointerMove(window, { clientX: 300 })
    fireEvent.pointerUp(window, { clientX: 300 })

    expect(sidebarState()).toBe('expanded')
    expect(publishedWidth()).toBe('300px')
  })

  test('a press that does not travel is still the toggle', () => {
    render(<Fixture />)

    fireEvent.pointerDown(rail(), { button: 0, clientX: 272 })
    fireEvent.pointerMove(window, { clientX: 274 })
    fireEvent.pointerUp(window, { clientX: 274 })
    fireEvent.click(rail())

    expect(sidebarState()).toBe('collapsed')
    expect(publishedWidth()).toBe('272px')
  })

  test('a completed drag does not also toggle on the click that ends it', () => {
    render(<Fixture />)

    fireEvent.pointerDown(rail(), { button: 0, clientX: 272 })
    fireEvent.pointerMove(window, { clientX: 352 })
    fireEvent.pointerUp(window, { clientX: 352 })
    fireEvent.click(rail())

    expect(sidebarState()).toBe('expanded')
    expect(publishedWidth()).toBe('352px')
  })

  test('ignores a non-primary button', () => {
    render(<Fixture />)

    fireEvent.pointerDown(rail(), { button: 2, clientX: 272 })
    fireEvent.pointerMove(window, { clientX: 352 })

    expect(publishedWidth()).toBe('272px')
  })

  test('releases the cursor and the selection lock it takes for the drag', () => {
    render(<Fixture />)

    fireEvent.pointerDown(rail(), { button: 0, clientX: 272 })
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')

    fireEvent.pointerUp(window, { clientX: 272 })

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })
})

describe('SidebarRail - keyboard', () => {
  test('names both of the edge\'s moves, the right way round for where it is', () => {
    render(<Fixture />)
    expect(rail()).toHaveAttribute('title', 'Drag to resize, click to collapse')

    fireEvent.click(rail())

    expect(sidebarState()).toBe('collapsed')
    expect(rail()).toHaveAttribute('title', 'Drag or click to expand the sidebar')
  })

  test('is a tab stop that reports the width it controls', () => {
    render(<Fixture />)

    expect(rail()).toHaveAttribute('aria-valuenow', '272')
    expect(rail()).toHaveAttribute('aria-valuemin', '64')
    expect(rail()).toHaveAttribute('aria-valuemax', '420')
    expect(rail()).not.toHaveAttribute('tabindex')
  })

  test('arrows resize by a step, Shift by the coarse one', () => {
    render(<Fixture />)

    fireEvent.keyDown(rail(), { key: 'ArrowRight' })
    expect(publishedWidth()).toBe('288px')

    fireEvent.keyDown(rail(), { key: 'ArrowRight', shiftKey: true })
    expect(publishedWidth()).toBe('352px')

    fireEvent.keyDown(rail(), { key: 'ArrowLeft' })
    expect(publishedWidth()).toBe('336px')
    expect(window.localStorage.getItem(WIDTH_KEY)).toBe('336')
  })

  test('Home and End go to the bounds', () => {
    render(<Fixture />)

    fireEvent.keyDown(rail(), { key: 'End' })
    expect(publishedWidth()).toBe('420px')

    fireEvent.keyDown(rail(), { key: 'Home' })
    expect(publishedWidth()).toBe('200px')
  })

  test('one more shrink at the floor collapses, and a grow brings it back', () => {
    render(<Fixture />)

    fireEvent.keyDown(rail(), { key: 'Home' })
    expect(sidebarState()).toBe('expanded')

    fireEvent.keyDown(rail(), { key: 'ArrowLeft' })
    expect(sidebarState()).toBe('collapsed')
    expect(rail()).toHaveAttribute('aria-valuenow', '64')

    fireEvent.keyDown(rail(), { key: 'ArrowRight' })
    expect(sidebarState()).toBe('expanded')
    expect(publishedWidth()).toBe('200px')
  })

  test('mirrors the directions on a right-hand rail', () => {
    render(
      <SidebarProvider>
        <Sidebar side="right" collapsible="icon">
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>
    )

    fireEvent.keyDown(rail(), { key: 'ArrowLeft' })
    expect(publishedWidth()).toBe('288px')

    fireEvent.pointerDown(rail(), { button: 0, clientX: 1000 })
    fireEvent.pointerMove(window, { clientX: 940 })
    fireEvent.pointerUp(window, { clientX: 940 })
    expect(publishedWidth()).toBe('348px')
  })

  test('leaves keys it does not own to the page', () => {
    render(<Fixture />)

    const event = fireEvent.keyDown(rail(), { key: 'PageDown' })

    expect(event).toBe(true)
    expect(publishedWidth()).toBe('272px')
  })
})

describe('useSidebar width', () => {
  test('a controlled `open` still restores the dragged width', () => {
    window.localStorage.setItem(WIDTH_KEY, '408')

    render(
      <SidebarProvider open={false} onOpenChange={() => {}}>
        <Sidebar collapsible="icon">
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>
    )

    expect(publishedWidth()).toBe('408px')
  })

  test('exposes the width to consumers', () => {
    const seen: number[] = []
    const Probe = (): null => {
      const { width } = useSidebar()
      useEffect(() => {
        seen.push(width)
      }, [width])
      return null
    }

    render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarRail />
        </Sidebar>
        <Probe />
      </SidebarProvider>
    )
    drag(272, 352)

    expect(seen.at(-1)).toBe(352)
  })
})

describe('Sidebar - on a phone', () => {
  test('renders nothing, so no unreachable drawer stays in the tree', () => {
    mobile.value = true
    try {
      const { container } = render(
        <SidebarProvider>
          <Sidebar collapsible="icon">
            <nav>Chat</nav>
          </Sidebar>
        </SidebarProvider>
      )
      expect(container.querySelector('[data-slot="sidebar"]')).toBeNull()
      expect(screen.queryByText('Chat')).toBeNull()
    } finally {
      mobile.value = false
    }
  })
})

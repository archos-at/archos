import type { JSX } from 'react'
import { useEffect } from 'react'
import { act, render, screen } from '@/test-utils'
import { vi, describe, test, expect, afterEach, beforeEach } from 'vitest'
import { DOCK_LAYOUT_QUERY } from '@/hooks/use-is-mobile'
import { AppShellChrome } from './app-shell-chrome'
import { useStartDock } from './start-dock'

let pathname = '/app/projects/p1/chat'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => null,
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock('./app-sidebar', () => ({
  AppSidebar: ({ projectId }: { projectId: string }) => (
    <div data-testid="rail" data-project-id={projectId} />
  ),
}))
vi.mock('./org-header', () => ({
  OrgHeader: () => <div data-testid="org-header" />,
}))
vi.mock('@/features/onboarding/components/product-tour', () => ({
  ProductTour: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('./phone-tab-bar', () => ({
  PhoneTabBar: ({ projectId }: { projectId: string | null }) => (
    <nav data-testid="tab-bar" data-project-id={projectId ?? 'org'} />
  ),
}))
vi.mock('./phone-more-sheet', () => ({
  PhoneMoreSheet: () => <div data-testid="more-sheet" />,
}))
let keyboardUp = false
vi.mock('./use-keyboard-up', () => ({
  useKeyboardUp: () => keyboardUp,
}))

const baseProps = {
  projects: [],
  authRequired: false,
  canManageOrganization: false,
  canViewOrganization: false,
  canManagePlatform: false,
  canAccessOfficeShelf: true,
  canAccessInbox: true,
  showSkills: false,
  showModels: false,
  tours: { welcome: false, project: false },
  overlay: null,
}

afterEach(() => {
  pathname = '/app/projects/p1/chat'
  keyboardUp = false
})

describe('AppShellChrome — which chrome stands', () => {
  test('inside a project: the rail, with that project id', () => {
    render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.getByTestId('rail')).toHaveAttribute('data-project-id', 'p1')
    expect(screen.queryByTestId('org-header')).not.toBeInTheDocument()
  })

  test('above a project: the org header, full stop', () => {
    pathname = '/app/projects'
    render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.getByTestId('org-header')).toBeInTheDocument()
    expect(screen.queryByTestId('rail')).not.toBeInTheDocument()
  })
})

describe('AppShellChrome — overlay routes keep the chrome of the covered page', () => {
  test('opening the office shelf over a project keeps the project rail standing', () => {
    const { rerender } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    pathname = '/app/office-shelf'
    rerender(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.getByTestId('rail')).toHaveAttribute('data-project-id', 'p1')
    expect(screen.queryByTestId('org-header')).not.toBeInTheDocument()
  })

  test('opening the Postfach over the org home keeps the org header standing', () => {
    pathname = '/app/projects'
    const { rerender } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    pathname = '/app/inbox'
    rerender(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.getByTestId('org-header')).toBeInTheDocument()
  })

  test('a hard load of an overlay URL has no covered page — org header stands', () => {
    pathname = '/app/office-shelf'
    render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.getByTestId('org-header')).toBeInTheDocument()
    expect(screen.queryByTestId('rail')).not.toBeInTheDocument()
  })

  test('navigating on from an overlay releases the remembered scope', () => {
    const { rerender } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    pathname = '/app/office-shelf'
    rerender(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    pathname = '/app/projects'
    rerender(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.getByTestId('org-header')).toBeInTheDocument()
    expect(screen.queryByTestId('rail')).not.toBeInTheDocument()
  })
})

describe('AppShellChrome — height', () => {
  test('the frame follows the visual viewport while the iOS keyboard is up, 100dvh otherwise', () => {
    const { container } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    const frame = container.querySelector('.overflow-hidden')
    expect(frame?.className).toContain('h-[var(--visual-viewport-height,100dvh)]')
  })
})

describe('AppShellChrome — the phone tab bar', () => {
  test('stands after the page in both scopes, carrying the scope it is in', () => {
    const { container, unmount } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    const bar = screen.getByTestId('tab-bar')
    expect(bar).toHaveAttribute('data-project-id', 'p1')
    const frame = container.querySelector('[data-tab-bar]')!
    expect(Array.from(frame.children).indexOf(bar)).toBeGreaterThan(0)
    expect(screen.getByTestId('more-sheet')).toBeInTheDocument()
    unmount()

    pathname = '/app/projects'
    render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.getByTestId('tab-bar')).toHaveAttribute('data-project-id', 'org')
    expect(screen.queryByTestId('more-sheet')).toBeNull()
  })

  test('stands down while the keyboard is up, and zeroes the inset a composer pads for', () => {
    keyboardUp = true
    const { container } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.queryByTestId('tab-bar')).toBeNull()
    const frame = container.querySelector('[data-tab-bar]')!
    expect(frame).toHaveAttribute('data-tab-bar', 'hidden')
    expect(frame).toHaveAttribute('data-keyboard', 'up')
    expect(frame.className).toContain('data-[keyboard=up]:[--shell-inset-bottom:0px]')
  })

  test('the chat route on a phone always has a way to the navigation: the bar returns when the keyboard goes', () => {
    pathname = '/app/projects/p1/chat'
    keyboardUp = true
    const { rerender } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.queryByTestId('tab-bar')).toBeNull()

    keyboardUp = false
    rerender(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.getByTestId('tab-bar')).toHaveAttribute('data-project-id', 'p1')
  })

  test('stands down on the intake wizard, which has its own footer', () => {
    pathname = '/app/projects/p1/intake'
    render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.queryByTestId('tab-bar')).toBeNull()
  })

  test('while it stands, the page below is told the bar clears the home indicator', () => {
    const { container } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    const frame = container.querySelector('[data-tab-bar]')!
    expect(frame).toHaveAttribute('data-tab-bar', 'shown')
    expect(frame.className).toContain('[--shell-inset-bottom:env(safe-area-inset-bottom)]')
    expect(frame.className).toContain('max-md:data-[tab-bar=shown]:[--shell-inset-bottom:0px]')
  })
})

describe('AppShellChrome — the panel docked beside the page (ADR-0148)', () => {
  const realMatchMedia = window.matchMedia
  let roomy = true
  beforeEach(() => {
    roomy = true
    window.matchMedia = ((query: string) => ({
      matches: query === DOCK_LAYOUT_QUERY ? roomy : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  })
  afterEach(() => {
    window.matchMedia = realMatchMedia
    vi.unstubAllGlobals()
    act(() => useStartDock.getState().close())
  })

  const inset = () => document.documentElement.style.getPropertyValue('--page-inset-start')
  let pageMounts = 0
  function Page(): JSX.Element {
    useEffect(() => {
      pageMounts += 1
    }, [])
    return <p>page</p>
  }

  test('docks what the layout handed over, publishes where the page begins, and never remounts the page', () => {
    pageMounts = 0
    const { rerender } = render(<AppShellChrome {...baseProps} startDock={{ inbox: <aside>postfach</aside> }}><Page /></AppShellChrome>)
    expect(screen.queryByText('postfach')).not.toBeInTheDocument()
    expect(inset()).toBe('')
    act(() => useStartDock.getState().open('inbox'))
    rerender(<AppShellChrome {...baseProps} startDock={{ inbox: <aside>postfach</aside> }}><Page /></AppShellChrome>)
    expect(screen.getByText('postfach')).toBeInTheDocument()
    expect(inset()).not.toBe('')
    act(() => useStartDock.getState().close())
    expect(screen.queryByText('postfach')).not.toBeInTheDocument()
    expect(inset()).toBe('')
    expect(pageMounts).toBe(1)
  })

  test('docks nothing the layout did not hand over, and nothing where there is no room', () => {
    act(() => useStartDock.getState().open('inbox'))
    const { unmount } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.queryByText('postfach')).not.toBeInTheDocument()
    unmount()
    roomy = false
    render(<AppShellChrome {...baseProps} startDock={{ inbox: <aside>postfach</aside> }}>page</AppShellChrome>)
    expect(screen.queryByText('postfach')).not.toBeInTheDocument()
    expect(inset()).toBe('')
  })
})

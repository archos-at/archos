import { render, screen } from '@/test-utils'
import { vi, describe, test, expect, afterEach } from 'vitest'
import { AppShellChrome } from './app-shell-chrome'
import { PhonePlaceOfShell } from './phone-floating-bar'
import type { OverviewProject } from '@/lib/projects/overview-project'

let pathname = '/app/projects/p1/chat'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => null,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}))
let railMounts = 0
vi.mock('./app-sidebar', async () => {
  const { useEffect } = await import('react')
  return {
    AppSidebar: ({ projectId, onSide }: { projectId: string | null; onSide: boolean }) => {
      useEffect(() => {
        railMounts += 1
      }, [])
      return <div data-testid="rail" data-project-id={projectId ?? 'personal'} data-on-side={String(onSide)} />
    },
  }
})
vi.mock('@/features/onboarding/components/product-tour', () => ({
  ProductTour: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
let keyboardUp = false
vi.mock('./use-keyboard-up', () => ({
  useKeyboardUp: () => keyboardUp,
}))

const project = (id: string): OverviewProject => ({
  id,
  name: `Projekt ${id}`,
  status: 'active',
  profileUpdatedAt: null,
  createdAt: new Date(2026, 10, 1),
  place: null,
  phase: null,
  searchText: '',
})

const baseProps = {
  projects: [project('p1'), project('p2')],
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
  railMounts = 0
})

describe('AppShellChrome — the phone page', () => {
  test('a chat draws its own header under the floating buttons; any other page is pushed below them', () => {
    const { container, rerender } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    const frame = container.querySelector('[data-phone-page]')!
    expect(frame).toHaveAttribute('data-phone-page', 'chat')
    expect(frame.className).toContain('max-md:data-[phone-page=page]:[--phone-main-top:var(--phone-top-room)]')
    for (const path of ['/app/projects/p1/files', '/app/personal-shelf', '/app/inbox']) {
      pathname = path
      rerender(<AppShellChrome {...baseProps}>page</AppShellChrome>)
      expect(frame).toHaveAttribute('data-phone-page', 'page')
    }
    pathname = '/app/personal/chat'
    rerender(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(frame).toHaveAttribute('data-phone-page', 'chat')
  })

  test('tells the page which place it is in: the project’s name, or the personal side', () => {
    const { rerender } = render(<AppShellChrome {...baseProps}><PhonePlaceOfShell /></AppShellChrome>)
    expect(screen.getByTestId('phone-place')).toHaveTextContent('Projekt p1')
    pathname = '/app/personal/chat'
    rerender(<AppShellChrome {...baseProps}><PhonePlaceOfShell /></AppShellChrome>)
    expect(screen.getByTestId('phone-place')).toHaveTextContent('Personal')
  })
})

describe('AppShellChrome — one chrome on every page', () => {
  test('inside a project: the rail on that project’s side', () => {
    render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.getByTestId('rail')).toHaveAttribute('data-project-id', 'p1')
    expect(screen.getByTestId('rail')).toHaveAttribute('data-on-side', 'true')
  })

  test('the rail never remounts between pages: project → Postfach → Suche → Organisation → Persönlich', () => {
    const { rerender } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    for (const path of ['/app/inbox', '/app/search', '/app/organization/members', '/app/personal/chat']) {
      pathname = path
      rerender(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    }
    expect(railMounts).toBe(1)
  })

  test('a page with no side keeps the side the person came from, with nothing of it lit', () => {
    const { rerender } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    for (const path of ['/app/inbox', '/app/office-shelf', '/app/profile', '/app/projects']) {
      pathname = path
      rerender(<AppShellChrome {...baseProps}>page</AppShellChrome>)
      expect(screen.getByTestId('rail')).toHaveAttribute('data-project-id', 'p1')
      expect(screen.getByTestId('rail')).toHaveAttribute('data-on-side', 'false')
    }
    pathname = '/app/personal-shelf'
    rerender(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    pathname = '/app/whats-new'
    rerender(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.getByTestId('rail')).toHaveAttribute('data-project-id', 'personal')
  })

  test('a hard load of a page with no side stands on the side the server read from the last place', () => {
    pathname = '/app/inbox'
    render(<AppShellChrome {...baseProps} lastSide={{ mode: 'project', projectId: 'p2' }}>page</AppShellChrome>)
    expect(screen.getByTestId('rail')).toHaveAttribute('data-project-id', 'p2')
  })

  test('a project deleted from under the rail gives way: the refreshed overview stands on the server’s side, then Persönlich', () => {
    const { rerender } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    pathname = '/app/projects'
    const afterDelete = { ...baseProps, projects: [project('p2')] }
    rerender(<AppShellChrome {...afterDelete} lastSide={{ mode: 'project', projectId: 'p2' }}>page</AppShellChrome>)
    expect(screen.getByTestId('rail')).toHaveAttribute('data-project-id', 'p2')
    rerender(<AppShellChrome {...afterDelete} lastSide={{ mode: 'project', projectId: 'p1' }}>page</AppShellChrome>)
    expect(screen.getByTestId('rail')).toHaveAttribute('data-project-id', 'personal')
  })

  test('with no last place, a page with no side stands on Persönlich', () => {
    pathname = '/app/projects'
    render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    expect(screen.getByTestId('rail')).toHaveAttribute('data-project-id', 'personal')
  })
})

describe('AppShellChrome — height', () => {
  test('the frame follows the visual viewport while the iOS keyboard is up, 100dvh otherwise', () => {
    const { container } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    const frame = container.querySelector('.overflow-hidden')
    expect(frame?.className).toContain('h-[var(--visual-viewport-height,100dvh)]')
  })
})

describe('AppShellChrome — the keyboard', () => {
  test('zeroes the inset a composer pads for while the keyboard is up', () => {
    keyboardUp = true
    const { container } = render(<AppShellChrome {...baseProps}>page</AppShellChrome>)
    const frame = container.querySelector('[data-phone-page]')!
    expect(frame).toHaveAttribute('data-keyboard', 'up')
    expect(frame.className).toContain('[--shell-inset-bottom:env(safe-area-inset-bottom)]')
    expect(frame.className).toContain('data-[keyboard=up]:[--shell-inset-bottom:0px]')
  })
})

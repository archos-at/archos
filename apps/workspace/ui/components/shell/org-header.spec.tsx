import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { fireEvent, render, screen } from '@/test-utils'
import { vi, describe, test, expect, afterEach } from 'vitest'
import { PRODUCT_NAME } from '@/lib/brand'
import { OrgHeader } from './org-header'
import { BRAND_INSET_ORG, BRAND_ROW } from './brand-slot'
import { useShellOverlays } from './shell-overlays'
import { useStartDock } from './start-dock'

let pathname = '/app/projects'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: forwardRef<
    HTMLAnchorElement,
    { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>
  >(function MockLink({ href, children, ...rest }, ref) {
    return (
      <a ref={ref} href={href} {...rest}>
        {children}
      </a>
    )
  }),
}))

const userMenuProps = vi.fn()
vi.mock('./sidebar-user-menu', () => ({
  SidebarUserMenu: (props: { organizations?: unknown }) => {
    userMenuProps(props)
    return <div data-testid="user-menu" />
  },
}))

// The badge subscription is the hook's own concern; here only the count's
// placement matters.
let pending = 0
vi.mock('@/features/collaboration/hooks/use-inbox', () => ({
  useInboxBadge: () => ({ pending }),
}))

const baseProps = {
  user: { name: 'Anna Berger', email: 'anna.berger@example.at' },
  organizationName: 'Musterarchitektur ZT GmbH',
  authRequired: false,
  canManageOrganization: false,
  canViewOrganization: false,
  canManagePlatform: false,
  canAccessOfficeShelf: true,
  canAccessInbox: true,
}

let mobile = false
// Only the hook is stood in for: the module's named queries stay real.
vi.mock('@/hooks/use-is-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-is-mobile')>()),
  useIsMobile: () => mobile,
}))
vi.mock('./connection-band', () => ({ ConnectionBand: () => <div data-testid="connection-band" /> }))

afterEach(() => {
  pathname = '/app/projects'
  pending = 0
  mobile = false
  useShellOverlays.setState({ paletteOpen: false })
})

describe('OrgHeader — the org scope in one slim band', () => {
  test('carries the wordmark home link, both doorways, and the avatar menu', () => {
    render(<OrgHeader {...baseProps} />)
    expect(screen.getByRole('img', { name: PRODUCT_NAME }).closest('a')).toHaveAttribute('href', '/app/projects')
    expect(screen.getByLabelText('Office filing')).toHaveAttribute('href', '/app/office-shelf')
    expect(screen.getByLabelText('Inbox')).toHaveAttribute('href', '/app/inbox')
    expect(screen.getByTestId('user-menu')).toBeInTheDocument()
  })

  test('drops each doorway with its own gate', () => {
    render(<OrgHeader {...baseProps} canAccessOfficeShelf={false} canAccessInbox={false} />)
    expect(screen.queryByLabelText('Office filing')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Inbox')).not.toBeInTheDocument()
    // The avatar stays — the header is never just a wordmark.
    expect(screen.getByTestId('user-menu')).toBeInTheDocument()
  })

  test('marks the doorway whose sheet is open, and only that one', () => {
    pathname = '/app/office-shelf'
    render(<OrgHeader {...baseProps} />)
    expect(screen.getByLabelText('Office filing')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Inbox')).not.toHaveAttribute('aria-current')
  })

  // Owner decision 2026-11-12: above a project the Postfach opens as its dialog over
  // the page. Docked, it pushed the projects list aside from an edge with no rail.
  test('the Postfach doorway is a link to its dialog, never a door to the dock', () => {
    render(<OrgHeader {...baseProps} />)
    const inbox = screen.getByLabelText('Inbox')
    expect(inbox).not.toHaveAttribute('data-dock-door')
    expect(inbox).not.toHaveAttribute('aria-expanded')
    // A plain click is the link's own: nothing takes it over to open a panel.
    expect(fireEvent.click(inbox)).toBe(true)
    expect(useStartDock.getState().panel).toBeNull()
  })

  test('surfaces the pending count on the inbox doorway', () => {
    pending = 3
    render(<OrgHeader {...baseProps} />)
    const inbox = screen.getByLabelText('Inbox')
    expect(inbox.textContent).toContain('3')
  })
})

// Ticket #38, topic 7: the wordmark jumped going from here into a project. It
// stands in the row `brand-slot.ts` defines, the one the rail's head uses too.
describe('OrgHeader — the wordmark stands where the rail puts it', () => {
  test('centred in the shared 56px brand row, 24px in from `md`', () => {
    render(<OrgHeader {...baseProps} />)
    const row = screen.getByRole('img', { name: PRODUCT_NAME }).closest('a')?.parentElement?.parentElement
    for (const token of [...BRAND_ROW.split(' '), BRAND_INSET_ORG]) {
      expect(row?.className.split(' ')).toContain(token)
    }
  })
})

describe('OrgHeader — on a phone', () => {
  test('the doorways give way to the tab bar; search opens the palette', () => {
    mobile = true
    render(<OrgHeader {...baseProps} />)
    // Hidden by CSS below `md` (the tab bar carries them), still the desktop's.
    expect(screen.getByLabelText('Office filing').className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(screen.getByLabelText('Office filing').className).toContain('md:flex')
    const search = screen.getByTestId('shell-search')
    expect(search.className).toContain('md:hidden')
    expect(search.className).toContain('pointer-coarse:size-11')
    search.click()
    expect(useShellOverlays.getState().paletteOpen).toBe(true)
  })

  test('says when the connection is gone, in the band rather than a drawer', () => {
    mobile = true
    render(<OrgHeader {...baseProps} />)
    expect(screen.getByTestId('connection-band')).toBeInTheDocument()
  })

  test('leaves the desktop band as it was: no presence ping of its own', () => {
    render(<OrgHeader {...baseProps} />)
    expect(screen.queryByTestId('connection-band')).toBeNull()
  })
})

describe('the organization switcher', () => {
  test('is handed to the avatar menu, and the header band carries none', () => {
    const organizations = [
      { id: 'org_1', name: 'GRID Test', current: true },
      { id: 'org_2', name: 'feld72 Architekten', current: false },
    ]
    render(<OrgHeader {...baseProps} organizations={organizations} />)

    expect(userMenuProps).toHaveBeenLastCalledWith(expect.objectContaining({ organizations }))
    expect(screen.queryByTestId('user-menu-switch-organization')).not.toBeInTheDocument()
  })
})

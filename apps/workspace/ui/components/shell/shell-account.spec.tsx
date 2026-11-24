import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/projects/p1/files',
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: forwardRef<HTMLAnchorElement, { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>>(
    function MockLink({ href, children, ...rest }, ref) {
      return (
        <a ref={ref} href={href} {...rest}>
          {children}
        </a>
      )
    }
  ),
}))
const switchToOrganization = vi.fn(() => new Promise<void>(() => {}))
vi.mock('@workos-inc/authkit-nextjs/components', () => ({ useAuth: () => ({ switchToOrganization }) }))
vi.mock('@/adapters/auth/use-auth', () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }))
vi.mock('@/features/collaboration/hooks/use-inbox', () => ({ useInboxBadge: () => ({ pending: 0, connected: true, refresh: () => {} }) }))
vi.mock('@/hooks/use-last-project-section', () => ({ useRecordProjectSection: () => {}, pruneProjectSections: () => {} }))
vi.mock('./project-switcher', () => ({ ProjectSwitcher: () => <div /> }))
vi.mock('./connection-band', () => ({ ConnectionBand: () => null }))
vi.mock('@/components/brand/logo', () => ({ Logo: () => <div /> }))
const avatars: { surface: string; props: Record<string, unknown> }[] = []
vi.mock('./sidebar-user-menu', () => ({
  SidebarUserMenu: (props: Record<string, unknown>) => {
    avatars.push({ surface: props.compact === true && props.menuSide === 'bottom' ? 'top bar' : 'rail', props })
    return <div data-testid="user-menu" />
  },
}))

import { AppSidebar } from './app-sidebar'
import { OrgHeader } from './org-header'
import { PhoneMoreSheet } from './phone-more-sheet'
import { shellAccount, type ShellAccount } from './shell-account'
import { useShellOverlays } from './shell-overlays'

const ACCOUNT = {
  user: { name: 'Anna Berger', email: 'anna.berger@example.at' },
  organizationName: 'Musterarchitektur ZT GmbH',
  authRequired: true,
  organizations: [
    { id: 'org_1', name: 'Musterarchitektur ZT GmbH', current: true },
    { id: 'org_2', name: 'feld72 Architekten', current: false },
  ],
  canManageOrganization: true,
  canViewOrganization: true,
  canManagePlatform: false,
} satisfies Required<ShellAccount>

const ACCOUNT_KEYS = ['authRequired', 'canManageOrganization', 'canManagePlatform', 'canViewOrganization', 'organizationName', 'organizations', 'user']

afterEach(() => {
  avatars.length = 0
  useShellOverlays.setState({ moreSheetOpen: false })
})

describe('one account, in every place that shows it', () => {
  test('shellAccount carries every field of the account and nothing else', () => {
    expect(Object.keys(shellAccount({ ...ACCOUNT, canAccessInbox: true } as ShellAccount)).sort()).toEqual(ACCOUNT_KEYS)
  })

  test('the rail’s avatar and the top bar’s avatar get the same account, the office switch included', () => {
    render(
      <>
        <AppSidebar {...ACCOUNT} projectId="p1" projects={[{ id: 'p1', name: 'Seestadt' }]} canAccessInbox />
        <OrgHeader {...ACCOUNT} canAccessOfficeShelf canAccessInbox />
      </>
    )
    const rail = avatars.findLast((avatar) => avatar.surface === 'rail')
    const top = avatars.findLast((avatar) => avatar.surface === 'top bar')
    const accountOf = (props: Record<string, unknown> | undefined) => Object.fromEntries(ACCOUNT_KEYS.map((key) => [key, props?.[key]]))
    expect(accountOf(rail?.props)).toEqual(ACCOUNT)
    expect(accountOf(top?.props)).toEqual(accountOf(rail?.props))
  })

  test('„Mehr“ offers the switch to another office, and a tap on one starts it', async () => {
    const user = userEvent.setup()
    render(
      <PhoneMoreSheet
        {...ACCOUNT}
        projectId="p1"
        canAccessOfficeShelf
        canAccessInbox
        showSkills={false}
      />
    )
    useShellOverlays.setState({ moreSheetOpen: true })
    const switches = within(await screen.findByRole('dialog')).getByText('Switch organization').closest('[data-slot="phone-more-organizations"]') as HTMLElement
    expect(within(switches).getByRole('button', { name: /Musterarchitektur/ })).toBeDisabled()
    await user.click(within(switches).getByRole('button', { name: /feld72/ }))
    expect(switchToOrganization).toHaveBeenCalledWith('org_2')
  })

  test('„Mehr“ shows no switch to a person in one office', async () => {
    render(<PhoneMoreSheet {...ACCOUNT} organizations={[ACCOUNT.organizations[0]!]} projectId="p1" canAccessOfficeShelf canAccessInbox showSkills={false} />)
    useShellOverlays.setState({ moreSheetOpen: true })
    await screen.findByRole('dialog')
    expect(document.querySelector('[data-slot="phone-more-organizations"]')).toBeNull()
  })
})

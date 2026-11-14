import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { act, render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { PhoneMoreSheet } from './phone-more-sheet'
import { PhoneTabBar } from './phone-tab-bar'
import { useShellOverlays } from './shell-overlays'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/projects/p1/files', useRouter: () => ({ push: vi.fn() }) }))
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
vi.mock('@/features/collaboration/hooks/use-inbox', () => ({
  useInboxBadge: () => ({ pending: 0, connected: true, refresh: () => {} }),
}))
vi.mock('@/adapters/auth/use-auth', () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }))
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => true }))

afterEach(() => useShellOverlays.setState({ moreSheetOpen: false }))

const flags = {
  canAccessOfficeShelf: true,
  canAccessOfficeStandards: true,
  canAccessInbox: true,
  showSkills: true,
  canViewOrganization: true,
  canManageOrganization: false,
  canManagePlatform: false,
}

describe('PhoneMoreSheet', () => {
  test('a tap on "Mehr" opens a sheet with only what the bar lacks, and the account', async () => {
    const user = userEvent.setup()
    render(
      <>
        <PhoneTabBar projectId="p1" canAccessOfficeShelf canAccessInbox />
        <PhoneMoreSheet projectId="p1" authRequired {...flags} />
      </>
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'More' }))

    const sheet = await screen.findByRole('dialog')
    const links = within(sheet).getAllByRole('link').map((link) => link.getAttribute('data-destination'))
    expect(links).toEqual(['automation', 'officeShelf', 'baseKnowledge', 'search', 'profile', 'memory', 'organization', 'whats-new'])
    // None of the bar's own tabs is repeated.
    for (const name of ['Chat', 'Files', 'Overview']) {
      expect(within(sheet).queryByRole('link', { name })).toBeNull()
    }
    expect(within(sheet).getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  // The founder (2026-11-10): „we might want to move the project selector to
  // more on mobile“. It was a 44px press in the top band of every page.
  test('inside a project its first row is the project selector, which turns the sheet into the project list and back', async () => {
    const user = userEvent.setup()
    const projects = [
      { id: 'p1', name: 'Wohnbau Seestadt Baufeld D12' },
      { id: 'p2', name: 'Sanierung Amtshaus Favoriten' },
    ]
    render(<PhoneMoreSheet projectId="p1" projects={projects} projectName="Wohnbau Seestadt Baufeld D12" authRequired {...flags} />)
    act(() => useShellOverlays.getState().setMoreSheetOpen(true))
    const sheet = await screen.findByRole('dialog', { name: 'More' })

    // First among everything pressable in the sheet's body, and a press: white with its edge.
    const selector = sheet.querySelector<HTMLElement>('[data-project-selector]')!
    const body = selector.parentElement!
    expect(body.querySelectorAll('button, a')[0]).toBe(selector)
    expect(selector).toHaveClass('bg-sheet', 'shadow-press', 'min-h-14')
    expect(selector).toHaveAccessibleName('Switch project (current: Wohnbau Seestadt Baufeld D12)')
    // The name on one line at 16/600, „Switch project“ under it.
    const name = selector.querySelector('.whitespace-nowrap')!
    expect(name).toHaveClass('text-section')
    expect(name).toHaveAttribute('title', 'Wohnbau Seestadt Baufeld D12')
    expect(within(selector).getByText('Switch project')).toBeInTheDocument()

    await user.click(selector)
    const list = await screen.findByRole('dialog', { name: 'Switch project' })
    expect(within(list).getByRole('searchbox', { name: 'Search projects' })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Sanierung Amtshaus Favoriten' })).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: 'View all projects' })).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: 'Back to More' }))
    expect(await screen.findByRole('dialog', { name: 'More' })).toBeInTheDocument()
  })

  test('above a project, or without a project list, the sheet has no selector', () => {
    render(<PhoneMoreSheet projectId={null} authRequired {...flags} />)
    act(() => useShellOverlays.getState().setMoreSheetOpen(true))
    expect(document.querySelector('[data-project-selector]')).toBeNull()
  })
})

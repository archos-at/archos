import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { render } from '@/test-utils'
import { AppSidebar } from '@/components/shell/app-sidebar'
import { PhoneChatSideRow } from '@/components/shell/phone-side-bar'
import { PhoneTabBar } from '@/components/shell/phone-tab-bar'
import { PERSONAL_CHAT_PATH } from '@/components/shell/rail-mode'
import {
  TOURS,
  TOUR_HOME,
  placeStops,
  type AnchorBox,
  type TourId,
  type TourReader,
} from '@/lib/onboarding/product-tour'

let pathname = TOUR_HOME
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
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
    },
  ),
}))

vi.mock('@/hooks/use-last-project-section', () => ({
  useRecordProjectSection: () => {},
  pruneProjectSections: () => {},
}))
vi.mock('@/features/collaboration/hooks/use-inbox', () => ({
  useInboxBadge: () => ({ pending: 0, connected: true, refresh: () => {} }),
}))
vi.mock('@/adapters/auth/use-auth', () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }))
vi.mock('@/components/brand/logo', () => ({ Logo: () => <span>wordmark</span> }))

let mobile = false
vi.mock('@/hooks/use-is-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-is-mobile')>()),
  useIsMobile: () => mobile,
}))

const PROJECTS = [{ id: 'p1', name: 'Wohnbau Seestadt' }]
const WHERE: Record<TourId, { pathname: string; projectId: string | null }> = {
  welcome: { pathname: PERSONAL_CHAT_PATH, projectId: null },
  project: { pathname: '/app/projects/p1/chat', projectId: 'p1' },
}

const READERS: Record<string, Omit<TourReader, 'phone'>> = {
  admin: { canAccessOfficeShelf: true, canAccessInbox: true, canManageOrganization: true, handover: true },
  member: { canAccessOfficeShelf: true, canAccessInbox: true, canManageOrganization: false, handover: false },
  bare: { canAccessOfficeShelf: false, canAccessInbox: false, canManageOrganization: false, handover: false },
}

const BOX: AnchorBox = { left: 0, right: 10, top: 0, bottom: 10 }

function shell(tour: TourId, reader: Omit<TourReader, 'phone'>): void {
  const { pathname: at, projectId } = WHERE[tour]
  pathname = at
  render(
    <>
      <AppSidebar
        projectId={projectId}
        projects={PROJECTS}
        authRequired={false}
        user={{ name: 'Anna Berger', email: 'anna@example.at' }}
        organizationName="Musterarchitektur"
        canAccessOfficeShelf={reader.canAccessOfficeShelf}
        canAccessInbox={reader.canAccessInbox}
        canManageOrganization={reader.canManageOrganization}
        canViewOrganization
        showModels={false}
        showSkills={false}
      />
      <main>
        <PhoneChatSideRow projectId={projectId} onSide projects={PROJECTS} pathname={at} />
      </main>
      {mobile && (
        <PhoneTabBar
          projectId={projectId}
          pathname={at}
          canAccessOfficeShelf={reader.canAccessOfficeShelf}
          canAccessInbox={reader.canAccessInbox}
        />
      )}
    </>,
  )
}

describe.each(['welcome', 'project'] as const)('the %s tour finds every anchor it points at in the shell', (tour) => {
  describe.each([
    ['desktop', false],
    ['phone', true],
  ] as const)('on a %s', (_viewport, phone) => {
    test.each(Object.keys(READERS))('for the %s', (name) => {
      mobile = phone
      const reader = { ...READERS[name]!, phone }
      shell(tour, reader)
      const intended = placeStops(TOURS[tour], reader, () => BOX, { width: 1280, height: 820 })
      // NextStep spotlights the first match: on a desktop it must be the rail's, not the hidden phone band's.
      const ownChrome = (element: Element): boolean => phone || element.closest('[data-sidebar="sidebar"]') !== null
      const found = placeStops(
        TOURS[tour],
        reader,
        (selector) => {
          const first = document.querySelector(selector)
          return first && ownChrome(first) ? BOX : null
        },
        { width: 1280, height: 820 },
      )
      expect(found.map((stop) => stop.id)).toEqual(intended.map((stop) => stop.id))
      expect(found.filter((stop) => stop.anchor).length).toBeGreaterThan(0)
    })
  })
})

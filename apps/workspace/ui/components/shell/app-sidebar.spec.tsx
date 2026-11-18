import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, afterEach } from 'vitest'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useShellOverlays } from './shell-overlays'
import { I18nProvider } from '@/i18n'
import { AppSidebar, railActivePillId } from './app-sidebar'
import { RECENT_CHATS_COLLAPSED_STORAGE_KEY, RailChatsSource, type RailChats } from './rail-chats'
import { BRAND_INSET_RAIL, BRAND_ROW } from './brand-slot'
import { PRODUCT_NAME } from '@/lib/brand'

let pathname = '/app/projects/p1/chat'
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

vi.mock('@/hooks/use-last-project-section', () => ({
  useRecordProjectSection: () => {},
  pruneProjectSections: () => {},
}))

vi.mock('./project-switcher', () => ({ ProjectSwitcher: () => <div /> }))
vi.mock('./connection-band', () => ({
  ConnectionBand: ({ appearance = 'band' }: { appearance?: string }) => (
    <div data-testid="connection-band" data-appearance={appearance} />
  ),
}))
vi.mock('./sidebar-user-menu', () => ({ SidebarUserMenu: () => <div /> }))
vi.mock('@/components/brand/logo', () => ({ Logo: () => <div /> }))

vi.mock('@/hooks/use-is-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-is-mobile')>()),
  useIsMobile: vi.fn(() => false),
}))

const baseProps = {
  projectId: 'p1',
  projects: [{ id: 'p1', name: 'Project One' }],
  authRequired: false,
  canAccessInbox: true,
}

afterEach(() => {
  pathname = '/app/projects/p1/chat'
  window.localStorage.removeItem('sidebar.collapsed')
  vi.mocked(useIsMobile).mockReturnValue(false)
  useShellOverlays.setState({ paletteOpen: false })
})

describe('the Inbox entry follows canAccessInbox, in both directions', () => {
  test('shows the entry when the reader may reach the inbox', () => {
    render(<AppSidebar {...baseProps} canAccessInbox />)
    expect(screen.getAllByText('Inbox').length).toBeGreaterThan(0)
  })

  test('hides it when they may not', () => {
    render(<AppSidebar {...baseProps} canAccessInbox={false} />)
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument()
  })
})

describe('AppSidebar - the wordmark stands where the org header puts it', () => {
  test('in the shared 56px brand row, 12px inside the head\'s own 12px', () => {
    render(<AppSidebar {...baseProps} />)
    const row = screen.getByRole('link', { name: `${PRODUCT_NAME} — all projects` }).parentElement
    for (const token of [...BRAND_ROW.split(' '), ...BRAND_INSET_RAIL.split(' ')]) {
      expect(row?.className.split(' ')).toContain(token)
    }
    const head = row?.closest('[data-sidebar="header"]')
    expect(head?.className).toContain('px-3')
    expect(head?.className).toContain('pt-[env(safe-area-inset-top)]')
  })
})

describe('AppSidebar - click-dummy IA (FB-9/FB-10)', () => {
  test('renders the core nav set: Chat, Files', () => {
    render(<AppSidebar {...baseProps} />)
    expect(screen.getAllByText('Chat').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Files').length).toBeGreaterThan(0)
  })

  test('Members, Research, Knowledge and History no longer appear in the nav', () => {
    render(<AppSidebar {...baseProps} canAccessOfficeShelf />)
    expect(screen.queryByText('Members')).not.toBeInTheDocument()
    expect(screen.queryByText('Research')).not.toBeInTheDocument()
    expect(screen.queryByText('Knowledge')).not.toBeInTheDocument()
    expect(screen.queryByText('History')).not.toBeInTheDocument()
  })

  test('renders the pinned Overview entry linking to the project hub', () => {
    render(<AppSidebar {...baseProps} />)
    const links = screen.getAllByText('Overview').map((el) => el.closest('a'))
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/app/projects/p1/settings')
    }
  })

  test('Chat links to a FRESH chat (?new=1), not the last thread', () => {
    render(<AppSidebar {...baseProps} />)
    const links = screen
      .getAllByText('Chat')
      .map((el) => el.closest('a'))
      .filter((link): link is HTMLAnchorElement => link !== null)
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/app/projects/p1/chat?new=1')
    }
  })

})

describe('AppSidebar - Automation nav item', () => {
  test('hides the Automation nav item by default (feature-flagged, default off)', () => {
    render(<AppSidebar {...baseProps} />)
    expect(screen.queryByText('Automation')).not.toBeInTheDocument()
    expect(screen.getAllByText('Chat').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Files').length).toBeGreaterThan(0)
  })

  test('shows the Automation nav item when showSkills is true, linking to the merged section', () => {
    render(<AppSidebar {...baseProps} showSkills />)
    const links = screen
      .getAllByText('Automation')
      .map((el) => el.closest('a'))
      .filter((link): link is HTMLAnchorElement => link !== null)
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/app/projects/p1/automation')
    }
  })
})

describe('AppSidebar - office shelf nav item (ADR-0024)', () => {
  test('shows office shelf when canAccessOfficeShelf is true, linking to the org office shelf', () => {
    render(<AppSidebar {...baseProps} canAccessOfficeShelf />)
    const links = screen.getAllByText('Office filing').map((el) => el.closest('a'))
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/app/office-shelf')
    }
  })

  test('hides office shelf by default (org feature flag off)', () => {
    render(<AppSidebar {...baseProps} />)
    expect(screen.queryByText('Office filing')).not.toBeInTheDocument()
  })

  test('orders Chat first and Inbox last in the section nav', () => {
    const { container } = render(<AppSidebar {...baseProps} canAccessOfficeShelf canAccessOfficeStandards />)
    const navs = container.querySelectorAll('[data-sidebar="sidebar"] nav')
    expect(navs.length).toBeGreaterThan(0)
    const labels = Array.from(navs)
      .flatMap((nav) => Array.from(nav.querySelectorAll('a span[data-slot="rail-nav-label"]')))
      .map((el) => el.textContent)
    expect(labels).toEqual(['Chat', 'Files', 'Overview', 'Office filing', 'Office standards', 'Search', 'Inbox'])
  })

  test('lists no office standards without the office-standards entitlement, the Archiv still there', () => {
    render(<AppSidebar {...baseProps} canAccessOfficeShelf />)
    expect(screen.queryByText('Office standards')).not.toBeInTheDocument()
    expect(screen.getAllByText('Office filing').length).toBeGreaterThan(0)
  })
})

describe('AppSidebar - the project hub stands with the project', () => {
  test('Overview is in the project sections, not among the organisation doorways', () => {
    render(<AppSidebar {...baseProps} canAccessOfficeShelf />)
    expect(within(screen.getByLabelText('Project sections')).getByText('Overview')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Organization' })).queryByText('Overview')).toBeNull()
  })
})

describe('AppSidebar - collapsed icon rail', () => {
  test('keeps nav labels in the a11y tree but does not paint them', async () => {
    const user = userEvent.setup()
    render(<AppSidebar {...baseProps} />)

    const sections = screen.getByLabelText('Project sections')
    const org = screen.getByRole('navigation', { name: 'Organization' })
    expect(within(sections).getByText('Chat')).toBeVisible()
    expect(sections.querySelector('[data-sidebar="group-label"]')).toBeNull()
    expect(within(org).getByText('Organization')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(within(sections).getByText('Chat')).toHaveClass('sr-only')
    expect(within(sections).getByText('Files')).toHaveClass('sr-only')
    expect(within(org).queryByText('Organization')).not.toBeInTheDocument()
  })
})

describe('AppSidebar - the fold control stays in the head', () => {
  test('in both widths', async () => {
    const user = userEvent.setup()
    render(<AppSidebar {...baseProps} />)
    const head = (): Element => document.querySelector('[data-sidebar="header"]')!
    expect(head()).toContainElement(screen.getByRole('button', { name: 'Collapse sidebar' }))
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(head()).toContainElement(screen.getByRole('button', { name: 'Expand sidebar' }))
  })
})

describe('AppSidebar - the resize edge', () => {
  const renderGerman = (): void => {
    render(
      <I18nProvider initialLocale="de" fixedLocale>
        <AppSidebar {...baseProps} />
      </I18nProvider>
    )
  }

  test('names the edge from the dictionary, in both of its states', async () => {
    const user = userEvent.setup()
    renderGerman()

    const edge = screen.getByRole('separator', { name: 'Breite der Seitenleiste ändern' })
    expect(edge).toHaveAttribute('title', 'Ziehen zum Ändern der Breite, klicken zum Einklappen')

    await user.click(screen.getByRole('button', { name: 'Seitenleiste einklappen' }))

    expect(screen.getByRole('separator', { name: 'Breite der Seitenleiste ändern' })).toHaveAttribute(
      'title',
      'Ziehen oder klicken zum Ausklappen'
    )
  })
})

describe('AppSidebar - mobile top bar', () => {
  test('hides the standalone mobile top bar on the chat route (chat owns its chrome)', () => {
    render(<AppSidebar {...baseProps} />)
    const banner = screen.getByRole('banner')
    expect(banner.className).toContain('hidden')
    expect(banner.className).not.toMatch(/(^|\s)flex(\s|$)/)
  })
})

describe('AppSidebar - the phone top band', () => {
  test('draws nothing over a page that has a header: no project name, no control', () => {
    pathname = '/app/projects/p1/files'
    render(<AppSidebar {...baseProps} />)
    const banner = screen.getByRole('banner')
    expect(banner).not.toHaveTextContent('Project One')
    expect(within(banner).queryAllByRole('button')).toEqual([])
    expect(within(banner).queryAllByRole('link')).toEqual([])
    expect(banner.querySelector('[data-slot="phone-bare-line"]')).toBeNull()
  })

  test('a bare flow has no page header, so its way back and the search keep one line, without the project’s name', async () => {
    pathname = '/app/projects/p1/setup'
    const user = userEvent.setup()
    render(<AppSidebar {...baseProps} />)
    const banner = screen.getByRole('banner')
    const line = banner.querySelector<HTMLElement>('[data-slot="phone-bare-line"]')!
    expect(within(line).getByRole('link', { name: 'Back to Overview' })).toHaveAttribute('href', '/app/projects/p1/settings')
    expect(banner).not.toHaveTextContent('Project One')
    await user.click(within(line).getByTestId('shell-search'))
    expect(useShellOverlays.getState().paletteOpen).toBe(true)
  })

  test('shows the connection on a phone, where the rail footer is out of sight', () => {
    pathname = '/app/projects/p1/files'
    vi.mocked(useIsMobile).mockReturnValue(true)
    render(<AppSidebar {...baseProps} />)
    expect(within(screen.getByRole('banner')).getByTestId('connection-band')).toBeInTheDocument()
    expect(screen.getAllByTestId('connection-band')).toHaveLength(1)
  })

  test('on a desktop the connection is a row of the rail footer, and the header carries none', () => {
    pathname = '/app/projects/p1/files'
    const { container } = render(<AppSidebar {...baseProps} />)
    const bands = screen.getAllByTestId('connection-band')
    expect(bands).toHaveLength(1)
    expect(bands[0]).toHaveAttribute('data-appearance', 'rail')
    expect(container.querySelector('[data-sidebar="footer"]')).toContainElement(bands[0]!)
  })
})

describe('AppSidebar - active state', () => {
  test('marks the Chat item as the current page on the chat route', () => {
    render(<AppSidebar {...baseProps} />)
    const chatLinks = screen.getAllByText('Chat').map((el) => el.closest('a'))
    expect(chatLinks.some((link) => link?.getAttribute('aria-current') === 'page')).toBe(true)
    const settingsLinks = screen.getAllByText('Overview').map((el) => el.closest('a'))
    for (const link of settingsLinks) {
      expect(link).not.toHaveAttribute('aria-current')
    }
  })

  test('draws the shared-layout pill on the active entry, and nowhere else', () => {
    const { container } = render(<AppSidebar {...baseProps} />)
    const pills = Array.from(container.querySelectorAll('[data-slot="rail-active-pill"]'))
    expect(pills).toHaveLength(1)
    expect(pills[0]!.closest('a')).toHaveAttribute('aria-current', 'page')
    expect(pills[0]!.closest('a')).toHaveTextContent('Chat')
  })

  test('the active entry is a sheet on the desk: white, with the thumb’s edge and shadow', () => {
    const { container } = render(<AppSidebar {...baseProps} />)
    const pill = container.querySelector('[data-slot="rail-active-pill"]')!
    expect(pill).toHaveClass('bg-sheet', 'shadow-xs')
    expect(pill.className).not.toMatch(/\bborder\b|\bborder-/)
    expect(pill.closest('a')).toHaveClass('text-foreground', 'font-medium')
  })

  test('a preview can pin the route the rail lights', () => {
    render(<AppSidebar {...baseProps} pathname="/app/projects/p1/settings" />)
    const overview = screen.getAllByText('Overview').map((el) => el.closest('a'))
    expect(overview.some((link) => link?.getAttribute('aria-current') === 'page')).toBe(true)
  })

  test('keys the pill identity by rail width, so it never scales across a collapse', () => {
    expect(railActivePillId(false)).not.toBe(railActivePillId(true))
    expect(railActivePillId(false)).toBe(railActivePillId(false))
  })
})

describe('AppSidebar - on a phone', () => {
  test('renders the top band and no rail', () => {
    pathname = '/app/projects/p1/files'
    vi.mocked(useIsMobile).mockReturnValue(true)
    const { container } = render(<AppSidebar {...baseProps} />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(container.querySelector('[data-sidebar="sidebar"]')).toBeNull()
  })
})

describe('AppSidebar - the organisation heads its doorways', () => {
  test("the doorways' heading is the organisation's name, at the foot with the person", () => {
    render(<AppSidebar {...baseProps} canAccessOfficeShelf organizationName="Musterarchitektur ZT GmbH" />)
    const org = screen.getByRole('navigation', { name: 'Musterarchitektur ZT GmbH' })
    expect(within(org).getByText('Musterarchitektur ZT GmbH')).toBeInTheDocument()
    expect(org.closest('[data-sidebar="footer"]')).not.toBeNull()
    expect(screen.getByLabelText('Project sections').closest('[data-sidebar="content"]')).not.toBeNull()
  })
})

describe('AppSidebar - the org doorways stay reachable from inside a project', () => {
  test('marks the office shelf doorway current while its sheet is open over the project', () => {
    pathname = '/app/office-shelf'
    render(<AppSidebar {...baseProps} canAccessOfficeShelf />)
    const officeShelf = screen
      .getAllByText('Office filing')
      .map((el) => el.closest('a'))
      .filter((link): link is HTMLAnchorElement => link !== null)
    expect(officeShelf.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true)
    expect(screen.getAllByText('Files').length).toBeGreaterThan(0)
  })
})

describe('AppSidebar - the project’s last chats under the sections', () => {
  const chats = (over: Partial<RailChats> = {}): RailChats => ({
    items: [
      { id: 'c1', title: 'Rettungswege Bürogebäude GK4 Wien', href: '/app/projects/p1/chat?session=c1', current: false },
      { id: 'c2', title: 'Fluchtweglänge im Erdgeschoss', href: '/app/projects/p1/chat?session=c2', current: true },
    ],
    allHref: '/app/projects/p1/chat',
    onOpen: vi.fn(),
    onOpenAll: vi.fn(),
    ...over,
  })
  const renderWith = (value: RailChats | null, props: Partial<typeof baseProps> & { pathname?: string } = {}) =>
    render(
      <RailChatsSource value={value}>
        <AppSidebar {...baseProps} {...props} />
      </RailChatsSource>
    )

  test('lists them under the sections, headed „Recent chats“, newest first, and „All chats“ last', () => {
    renderWith(chats())
    const list = screen.getByRole('list', { name: 'Recent chats' })
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Rettungswege Bürogebäude GK4 Wien', 'Fluchtweglänge im Erdgeschoss', 'All chats'])
    expect(links[0]).toHaveAttribute('href', '/app/projects/p1/chat?session=c1')
    expect(links[2]).toHaveAttribute('href', '/app/projects/p1/chat')
    const sectionsNav = screen.getByLabelText('Project sections')
    expect(within(sectionsNav).queryByText('Rettungswege Bürogebäude GK4 Wien')).toBeNull()
    expect(sectionsNav.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Recent chats' })).toBeInTheDocument()
  })

  test('the heading folds the list away and back, and the browser remembers it', async () => {
    window.localStorage.removeItem(RECENT_CHATS_COLLAPSED_STORAGE_KEY)
    const user = userEvent.setup()
    const { unmount } = renderWith(chats())
    const toggle = screen.getByRole('button', { name: 'Recent chats' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Fluchtweglänge im Erdgeschoss' })).toBeNull()
    expect(window.localStorage.getItem(RECENT_CHATS_COLLAPSED_STORAGE_KEY)).toBe('1')
    unmount()
    renderWith(chats())
    expect(await screen.findByRole('button', { name: 'Recent chats', expanded: false })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Recent chats' }))
    expect(screen.getByRole('link', { name: 'Fluchtweglänge im Erdgeschoss' })).toBeInTheDocument()
    window.localStorage.removeItem(RECENT_CHATS_COLLAPSED_STORAGE_KEY)
  })

  test('a title stays on one line, whole in its tooltip', () => {
    renderWith(chats())
    const row = screen.getByRole('link', { name: 'Rettungswege Bürogebäude GK4 Wien' })
    expect(row).toHaveAttribute('title', 'Rettungswege Bürogebäude GK4 Wien')
    expect(row.querySelector('span')).toHaveClass('truncate')
  })

  test('the open chat is the current place: the one sheet, and „Chat“ its ancestor in ink', () => {
    const { container } = renderWith(chats())
    const open = screen.getByRole('link', { name: 'Fluchtweglänge im Erdgeschoss' })
    expect(open).toHaveAttribute('aria-current', 'page')
    const pills = Array.from(container.querySelectorAll('[data-slot="rail-active-pill"]'))
    expect(pills).toHaveLength(1)
    expect(pills[0]!.closest('a')).toBe(open)
    const chat = within(screen.getByLabelText('Project sections')).getByText('Chat').closest('a')
    expect(chat).not.toHaveAttribute('aria-current')
    expect(chat).toHaveClass('text-foreground', 'font-medium')
  })

  test('a row shows what its chat is doing, and says it: working, waiting for an answer, answer ready, answer failed', () => {
    const base = chats().items[0]!
    renderWith(
      chats({
        items: [
          { ...base, id: 'w', title: 'Fluchtwege', activity: 'working' },
          { ...base, id: 'q', title: 'Stellplätze', activity: 'waiting' },
          { ...base, id: 'a', title: 'Abstandsflächen', activity: 'answered' },
          { ...base, id: 'f', title: 'Barrierefreiheit', activity: 'failed' },
          { ...base, id: 'n', title: 'Brandschutz', activity: null },
        ],
      })
    )
    expect(within(screen.getByRole('link', { name: 'Fluchtwege (working)' })).getByTestId('rail-chat-working')).toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: 'Stellplätze (waiting for your answer)' })).getByTestId('rail-chat-waiting')).toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: 'Abstandsflächen (answer ready)' })).getByTestId('rail-chat-answered')).toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: 'Barrierefreiheit (answer failed)' })).getByTestId('rail-chat-failed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Brandschutz' }).querySelector('[data-testid^="rail-chat-"]')).toBeNull()
  })

  test('with no chat open, „Chat“ stays the current place', () => {
    renderWith(chats({ items: chats().items.map((item) => ({ ...item, current: false })) }))
    const chat = within(screen.getByLabelText('Project sections')).getByText('Chat').closest('a')
    expect(chat).toHaveAttribute('aria-current', 'page')
  })

  test('a row and „All chats“ tell the chat’s side before the link is followed', async () => {
    const user = userEvent.setup()
    const value = chats()
    renderWith(value)
    await user.click(screen.getByRole('link', { name: 'Rettungswege Bürogebäude GK4 Wien' }))
    expect(value.onOpen).toHaveBeenCalledWith('c1')
    await user.click(screen.getByRole('link', { name: 'All chats' }))
    expect(value.onOpenAll).toHaveBeenCalledOnce()
  })

  test('a project with no chats shows nothing under „Chat“: no empty list, no „All chats“', () => {
    renderWith(chats({ items: [] }))
    expect(screen.queryByRole('list', { name: 'Recent chats' })).not.toBeInTheDocument()
    expect(screen.queryByText('All chats')).not.toBeInTheDocument()
  })

  test('without a source (a preview, a spec) the rail is as it was', () => {
    renderWith(null)
    expect(screen.queryByRole('list', { name: 'Recent chats' })).not.toBeInTheDocument()
  })

  test('the icon rail has no room for titles: „Chat“ is its glyph, and the list is gone', async () => {
    const user = userEvent.setup()
    renderWith(chats())
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.queryByRole('list', { name: 'Recent chats' })).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('Project sections')).getByText('Chat').closest('a')).toHaveAttribute('aria-current', 'page')
    expect(within(screen.getByLabelText('Project sections')).getByText('Chat').closest('a')?.getAttribute('href')).toMatch(/^\/app\/projects\/p1\/chat/)
  })
})

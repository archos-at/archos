import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@/test-utils'
import { SIDEBAR_PEEK_CLOSE_MS, SIDEBAR_PEEK_OPEN_MS } from '@/components/ui/sidebar-peek'
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

vi.mock('./project-switcher', async () => {
  const { useState } = await import('react')
  return {
    ProjectSwitcher: () => {
      const [open, setOpen] = useState(false)
      return <button type="button" data-testid="selector" data-state={open ? 'open' : 'closed'} onClick={() => setOpen(!open)} />
    },
  }
})
vi.mock('./connection-band', () => ({
  ConnectionBand: ({ appearance = 'band' }: { appearance?: string }) => (
    <div data-testid="connection-band" data-appearance={appearance} />
  ),
}))
vi.mock('./sidebar-user-menu', () => ({
  SidebarUserMenu: ({ beforeChevron }: { beforeChevron?: string }) => <div data-testid="user-menu" data-before-chevron={beforeChevron} />,
}))
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

describe('the inbox bell stands beside the person, for a reader who may reach the inbox', () => {
  test('is in the rail footer next to the user menu, and is not a section of the nav', () => {
    render(<AppSidebar {...baseProps} canAccessInbox />)
    const bell = screen.getByTestId('inbox-bell')
    expect(bell).toHaveAttribute('href', '/app/inbox')
    expect(bell.closest('[data-slot="rail-person"]')).toContainElement(screen.getByTestId('user-menu'))
    expect(bell.closest('nav')).toBeNull()
  })

  test('stands between the name and the chevron, unboxed, as the concept draws it', () => {
    render(<AppSidebar {...baseProps} canAccessInbox />)
    const bell = screen.getByTestId('inbox-bell')
    expect(bell).toHaveClass('absolute', 'border-transparent')
    expect(screen.getByTestId('user-menu')).toHaveAttribute('data-before-chevron', 'w-12')
  })

  test('is absent when the reader cannot reach the inbox', () => {
    render(<AppSidebar {...baseProps} canAccessInbox={false} />)
    expect(screen.queryByTestId('inbox-bell')).not.toBeInTheDocument()
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
    expect(screen.getAllByText('New chat').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Documents').length).toBeGreaterThan(0)
  })

  test('Members, Research, Knowledge and History no longer appear in the nav', () => {
    render(<AppSidebar {...baseProps} canAccessOfficeShelf />)
    expect(screen.queryByText('Members')).not.toBeInTheDocument()
    expect(screen.queryByText('Research')).not.toBeInTheDocument()
    expect(screen.queryByText('Knowledge')).not.toBeInTheDocument()
    expect(screen.queryByText('History')).not.toBeInTheDocument()
  })

  test('lists no Overview row: the project hub is reached from the project picker', () => {
    render(<AppSidebar {...baseProps} />)
    expect(screen.queryByText('Overview')).not.toBeInTheDocument()
  })

  test('Chat links to a FRESH chat (?new=1), not the last thread', () => {
    render(<AppSidebar {...baseProps} />)
    const links = screen
      .getAllByText('New chat')
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
    expect(screen.getAllByText('New chat').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Documents').length).toBeGreaterThan(0)
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
    const links = screen.getAllByText('Office library').map((el) => el.closest('a'))
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/app/office-shelf')
    }
  })

  test('hides office shelf by default (org feature flag off)', () => {
    render(<AppSidebar {...baseProps} />)
    expect(screen.queryByText('Office library')).not.toBeInTheDocument()
  })

  test('orders New chat first, keeps only the office library under the office, and the search in the head', () => {
    const { container } = render(<AppSidebar {...baseProps} canAccessOfficeShelf canAccessOfficeStandards />)
    const navs = container.querySelectorAll('[data-sidebar="sidebar"] nav')
    expect(navs.length).toBeGreaterThan(0)
    const labels = Array.from(navs)
      .flatMap((nav) => Array.from(nav.querySelectorAll('a span[data-slot="rail-nav-label"]')))
      .map((el) => el.textContent)
    expect(labels).toEqual(['New chat', 'Documents', 'Office library'])
    expect(container.querySelector('[data-sidebar="sidebar"] a[href="/app/search"]')).toBeNull()
    expect(container.querySelector('[data-sidebar="sidebar"] [data-testid="shell-search"]')).not.toBeNull()
  })

  test('keeps Office library lit on its standards tab, which has no doorway of its own', () => {
    pathname = '/app/base-knowledge'
    render(<AppSidebar {...baseProps} canAccessOfficeShelf canAccessOfficeStandards />)
    expect(screen.queryByText('Office standards')).not.toBeInTheDocument()
    const shelf = screen.getAllByRole('link', { name: /Office library/ })[0]
    expect(shelf).toHaveAttribute('data-active', 'true')
  })

  test('lists no office standards without the office-standards entitlement, the Archiv still there', () => {
    render(<AppSidebar {...baseProps} canAccessOfficeShelf />)
    expect(screen.queryByText('Office standards')).not.toBeInTheDocument()
    expect(screen.getAllByText('Office library').length).toBeGreaterThan(0)
  })
})


describe('AppSidebar - collapsed icon rail', () => {
  test('keeps nav labels in the a11y tree but does not paint them', async () => {
    const user = userEvent.setup()
    render(<AppSidebar {...baseProps} canAccessOfficeShelf />)

    const sections = screen.getByLabelText('Project sections')
    const org = screen.getByRole('navigation', { name: 'Organization' })
    expect(within(sections).getByText('New chat')).toBeVisible()
    expect(sections.querySelector('[data-sidebar="group-label"]')).toBeNull()
    expect(within(org).getByText('Organization')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(within(sections).getByText('New chat')).toHaveClass('sr-only')
    expect(within(sections).getByText('Documents')).toHaveClass('sr-only')
    expect(within(org).queryByText('Organization')).not.toBeInTheDocument()
  })
})

describe('AppSidebar - the folded rail opens over the page under the pointer', () => {
  const rail = (): HTMLElement => document.querySelector('[data-slot="sidebar-container"]')!
  const group = (): HTMLElement => document.querySelector('[data-slot="sidebar"]')!
  const fold = async (): Promise<void> => {
    render(<AppSidebar {...baseProps} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Collapse sidebar' }))
  }
  const enter = (pointerType = 'mouse'): void => {
    fireEvent.pointerEnter(rail(), { pointerType })
  }

  test('labels come back while the page keeps the strip’s width, and the control now keeps the rail open', async () => {
    await fold()
    expect(group()).toHaveAttribute('data-collapsible', 'icon')
    enter()
    await waitFor(() => expect(group()).toHaveAttribute('data-peek', 'true'))
    expect(group()).toHaveAttribute('data-gap', 'icon')
    expect(group()).toHaveAttribute('data-collapsible', '')
    expect(within(screen.getByLabelText('Project sections')).getByText('Documents')).not.toHaveClass('sr-only')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Keep the sidebar open' }))
    expect(group()).toHaveAttribute('data-state', 'expanded')
    expect(group()).not.toHaveAttribute('data-peek')
  })

  test('folds again once the pointer has left it', async () => {
    await fold()
    enter()
    await waitFor(() => expect(group()).toHaveAttribute('data-peek', 'true'))
    fireEvent.pointerMove(document.body)
    await waitFor(() => expect(group()).not.toHaveAttribute('data-peek'))
    expect(group()).toHaveAttribute('data-collapsible', 'icon')
  })

  test('stays open while a menu opened from it is open', async () => {
    await fold()
    enter()
    await waitFor(() => expect(group()).toHaveAttribute('data-peek', 'true'))
    await userEvent.setup().click(screen.getByTestId('selector'))
    expect(screen.getByTestId('selector')).toHaveAttribute('data-state', 'open')
    screen.getByTestId('selector').blur()
    fireEvent.pointerMove(document.body)
    await new Promise((resolve) => setTimeout(resolve, SIDEBAR_PEEK_CLOSE_MS + 80))
    expect(group()).toHaveAttribute('data-peek', 'true')

    await userEvent.setup().click(screen.getByTestId('selector'))
    screen.getByTestId('selector').blur()
    fireEvent.pointerMove(document.body)
    await waitFor(() => expect(group()).not.toHaveAttribute('data-peek'))
  })

  test('folds while the pointer keeps moving over the page, and when it leaves the window', async () => {
    await fold()
    enter()
    await waitFor(() => expect(group()).toHaveAttribute('data-peek', 'true'))
    const started = Date.now()
    const moving = window.setInterval(() => fireEvent.pointerMove(document.body), 40)
    await waitFor(() => expect(group()).not.toHaveAttribute('data-peek'))
    window.clearInterval(moving)
    expect(Date.now() - started).toBeLessThan(SIDEBAR_PEEK_CLOSE_MS * 3)

    enter()
    await waitFor(() => expect(group()).toHaveAttribute('data-peek', 'true'))
    fireEvent.pointerLeave(document.documentElement)
    await waitFor(() => expect(group()).not.toHaveAttribute('data-peek'))
  })

  test('a finger does not open it: a tap on a glyph goes straight there', async () => {
    await fold()
    enter('touch')
    await new Promise((resolve) => setTimeout(resolve, SIDEBAR_PEEK_OPEN_MS + 80))
    expect(group()).not.toHaveAttribute('data-peek')
  })

  test('does not open under a pointer that only crossed it', async () => {
    await fold()
    enter()
    fireEvent.pointerLeave(rail())
    await new Promise((resolve) => setTimeout(resolve, SIDEBAR_PEEK_OPEN_MS + 80))
    expect(group()).not.toHaveAttribute('data-peek')
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
    expect(within(line).getByRole('link', { name: 'Back to Project settings' })).toHaveAttribute('href', '/app/projects/p1/settings')
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
    const chatLinks = screen.getAllByText('New chat').map((el) => el.closest('a'))
    expect(chatLinks.some((link) => link?.getAttribute('aria-current') === 'page')).toBe(true)
    const filesLinks = screen.getAllByText('Documents').map((el) => el.closest('a'))
    for (const link of filesLinks) {
      expect(link).not.toHaveAttribute('aria-current')
    }
  })

  test('draws the shared-layout pill on the active entry, and nowhere else', () => {
    const { container } = render(<AppSidebar {...baseProps} />)
    const pills = Array.from(container.querySelectorAll('[data-slot="rail-active-pill"]'))
    expect(pills).toHaveLength(1)
    expect(pills[0]!.closest('a')).toHaveAttribute('aria-current', 'page')
    expect(pills[0]!.closest('a')).toHaveTextContent('New chat')
  })

  test('the active entry is a sheet on the desk: white, with the thumb’s edge and shadow', () => {
    const { container } = render(<AppSidebar {...baseProps} />)
    const pill = container.querySelector('[data-slot="rail-active-pill"]')!
    expect(pill).toHaveClass('bg-sheet', 'shadow-xs')
    expect(pill.className).not.toMatch(/\bborder\b|\bborder-/)
    expect(pill.closest('a')).toHaveClass('text-foreground', 'font-medium')
  })

  test('a preview can pin the route the rail lights', () => {
    render(<AppSidebar {...baseProps} pathname="/app/projects/p1/files" />)
    const files = screen.getAllByText('Documents').map((el) => el.closest('a'))
    expect(files.some((link) => link?.getAttribute('aria-current') === 'page')).toBe(true)
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
  test('marks the office library doorway current while its page stands beside the project’s rail', () => {
    pathname = '/app/office-shelf'
    render(<AppSidebar {...baseProps} canAccessOfficeShelf />)
    const officeShelf = screen
      .getAllByText('Office library')
      .map((el) => el.closest('a'))
      .filter((link): link is HTMLAnchorElement => link !== null)
    expect(officeShelf.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true)
    expect(screen.getAllByText('Documents').length).toBeGreaterThan(0)
  })
})

describe('AppSidebar - the project’s last chats under the sections', () => {
  const chats = (over: Partial<RailChats> = {}): RailChats => ({
    items: [
      { id: 'c1', title: 'Rettungswege Bürogebäude GK4 Wien', href: '/app/projects/p1/chat?session=c1', current: false },
      { id: 'c2', title: 'Fluchtweglänge im Erdgeschoss', href: '/app/projects/p1/chat?session=c2', current: true },
    ],
    allHref: '/app/projects/p1/chat',
    more: true,
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

  test('a quiet section label over quieter, tighter rows; „All chats“ only while more chats exist', () => {
    const { unmount } = renderWith({ ...chats(), more: false })
    const list = screen.getByRole('list', { name: 'Recent chats' })
    expect(within(list).queryByRole('link', { name: 'All chats' })).toBeNull()
    const heading = screen.getByRole('button', { name: 'Recent chats' })
    expect(heading).toHaveClass('text-meta', 'text-subtle', 'h-6', 'pointer-coarse:h-11')
    expect(heading.querySelector('svg')).toHaveClass('opacity-0', 'group-hover/heading:opacity-100', 'group-focus-visible/heading:opacity-100')
    const row = within(list).getByRole('link', { name: 'Rettungswege Bürogebäude GK4 Wien' })
    expect(row).toHaveClass('h-7', 'text-subtle', 'pointer-coarse:h-11')
    expect(within(list).getByRole('link', { name: 'Fluchtweglänge im Erdgeschoss' })).toHaveClass('text-foreground', 'font-medium')
    unmount()
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
    const chat = within(screen.getByLabelText('Project sections')).getByText('New chat').closest('a')
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
    const chat = within(screen.getByLabelText('Project sections')).getByText('New chat').closest('a')
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

  test('marks nothing in the strip for an open chat that is older than the listed ones', async () => {
    pathname = '/app/projects/p1/chat'
    renderWith(chats({ items: chats().items.map((chat) => ({ ...chat, current: false })), chatOpen: true }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(document.querySelector('[data-sidebar="sidebar"] [aria-current="page"]')).toBeNull()
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

  test('the icon rail has no room for titles: the list is gone, and with a chat open nothing in the strip is marked', async () => {
    const user = userEvent.setup()
    renderWith(chats())
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.queryByRole('list', { name: 'Recent chats' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-sidebar="sidebar"] [aria-current="page"]')).toBeNull()
    expect(document.querySelector('[data-slot="rail-active-pill"]')).toBeNull()
    expect(within(screen.getByLabelText('Project sections')).getByText('New chat').closest('a')?.getAttribute('href')).toMatch(/^\/app\/projects\/p1\/chat/)
  })
})

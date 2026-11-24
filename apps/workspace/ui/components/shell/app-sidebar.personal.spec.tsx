import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, afterEach } from 'vitest'
import { AppSidebar } from './app-sidebar'
import { RailChatsSource } from './rail-chats'
import { NEW_PERSONAL_CHAT_HREF, PERSONAL_CHAT_PATH, PERSONAL_SHELF_PATH } from './rail-mode'

let pathname = PERSONAL_SHELF_PATH
const push = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ back: vi.fn(), push, replace: vi.fn() }),
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
vi.mock('@/hooks/use-last-project-section', () => ({ useRecordProjectSection: () => {}, pruneProjectSections: () => {} }))
vi.mock('./project-switcher', () => ({ ProjectSwitcher: () => <div data-testid="project-switcher" /> }))
vi.mock('./connection-band', () => ({ ConnectionBand: () => <div /> }))
vi.mock('./sidebar-user-menu', () => ({ SidebarUserMenu: () => <div /> }))
vi.mock('@/components/brand/logo', () => ({ Logo: () => <div /> }))

const props = { projects: [{ id: 'p1', name: 'Project One' }], authRequired: false, canAccessInbox: true }

afterEach(() => {
  pathname = PERSONAL_SHELF_PATH
  push.mockClear()
  window.localStorage.removeItem('project.recent')
})

describe('the rail switches between Persönlich and Projekt (ADR-0193)', () => {
  test('under Persönlich: a new chat, Meine Ablage and the person’s last chats, and no project selector', () => {
    const chats = { items: [{ id: 'c1', title: 'Anfrage Huber', href: `${PERSONAL_CHAT_PATH}?session=c1`, current: false }], allHref: PERSONAL_CHAT_PATH }
    render(
      <RailChatsSource value={chats}>
        <AppSidebar {...props} projectId={null} />
      </RailChatsSource>
    )

    expect(screen.getByRole('radio', { name: 'Personal' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('link', { name: 'New chat' })).toHaveAttribute('href', NEW_PERSONAL_CHAT_HREF)
    expect(screen.getByRole('link', { name: 'Meine Ablage' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Anfrage Huber' })).toHaveAttribute('href', `${PERSONAL_CHAT_PATH}?session=c1`)
    expect(screen.queryByTestId('project-switcher')).toBeNull()
  })

  test('one list of last chats on both sides: a chat names its project, and a shared one says so', () => {
    const chats = {
      items: [
        { id: 'c1', title: 'Anfrage Huber', href: `${PERSONAL_CHAT_PATH}?session=c1`, current: false, projectId: null },
        { id: 'c2', title: 'Fluchtweg', href: '/app/projects/p1/chat?session=c2', current: false, projectId: 'p1', shared: true },
      ],
      allHref: PERSONAL_CHAT_PATH,
    }
    render(
      <RailChatsSource value={chats}>
        <AppSidebar {...props} projectId={null} />
      </RailChatsSource>
    )

    const shared = screen.getByRole('link', { name: /Fluchtweg/ })
    expect(shared).toHaveTextContent('Project One')
    expect(shared).toHaveTextContent('(shared)')
    const alone = screen.getByRole('link', { name: /Anfrage Huber/ })
    expect(alone).not.toHaveTextContent('Project One')
    expect(alone).not.toHaveTextContent('(shared)')
  })

  test('under Projekt: Neuer Chat first, with the switch and the project selector above it', () => {
    pathname = '/app/projects/p1/files'
    render(<AppSidebar {...props} projectId="p1" />)

    expect(screen.getByRole('radio', { name: 'Project' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('project-switcher')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Meine Ablage' })).toBeNull()
    expect(within(screen.getByLabelText('Project sections')).getAllByRole('link')[0]).toHaveTextContent('New chat')
  })

  test('switching goes to the personal chat, and back to the last project', async () => {
    const user = userEvent.setup()
    pathname = '/app/projects/p1/files'
    const { unmount } = render(<AppSidebar {...props} projectId="p1" />)
    await user.click(screen.getByRole('radio', { name: 'Personal' }))
    expect(push).toHaveBeenLastCalledWith(PERSONAL_CHAT_PATH)
    unmount()

    pathname = PERSONAL_SHELF_PATH
    window.localStorage.setItem('project.recent', JSON.stringify(['p1']))
    render(<AppSidebar {...props} projectId={null} />)
    await user.click(screen.getByRole('radio', { name: 'Project' }))
    expect(push).toHaveBeenLastCalledWith('/app/projects/p1/chat')
  })
})

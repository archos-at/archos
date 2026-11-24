import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, within } from '@/test-utils'
import type { InboxItemView } from '@/lib/inbox/types'

vi.mock('../hooks/use-inbox', () => ({ useInboxList: vi.fn(), useInboxBadge: vi.fn() }))

const page = vi.hoisted(() => ({ pathname: '/app/projects/p1/chat' }))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => page.pathname,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { useInboxBadge, useInboxList, type UseInboxListResult } from '../hooks/use-inbox'
import { InboxBell } from './InboxBell'

const row = (id: string, overrides: Partial<InboxItemView> = {}): InboxItemView => ({
  id,
  type: 'annotation.assigned_to_you',
  state: 'unread',
  archived: false,
  read: false,
  actionable: true,
  resourceType: 'document',
  resourceId: 'doc-eg',
  anchorId: `mark-${id}`,
  actorName: 'Anna Weber',
  actorUserId: 'u-anna',
  count: 1,
  href: `/app/projects/p1/files?doc=doc-eg&review=1&mark=mark-${id}`,
  subject: 'Ground floor plan',
  projectName: 'Linzer Strasse housing',
  related: '4',
  excerpt: `Note ${id}`,
  mentions: [],
  variant: null,
  answerIn: 'row',
  createdAt: '2026-10-29T08:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
  ...overrides,
})

function hook(items: InboxItemView[], overrides: Partial<UseInboxListResult> = {}): UseInboxListResult {
  return {
    items,
    pending: items.length,
    counts: { requests: 0, unread: 0 },
    loading: false,
    error: false,
    mutationError: false,
    dismissMutationError: vi.fn(),
    mutating: false,
    connected: true,
    refresh: vi.fn(),
    hasMore: false,
    loadingMore: false,
    loadMoreFailed: false,
    loadMore: vi.fn(),
    markRead: vi.fn(async () => {}),
    markUnread: vi.fn(async () => {}),
    markAllRead: vi.fn(async () => {}),
    archive: vi.fn(async () => {}),
    unarchive: vi.fn(async () => true),
    ...overrides,
  }
}

const waiting = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => row(id, { updatedAt: `2026-10-2${index}T08:00:00Z` }))

beforeEach(() => {
  page.pathname = '/app/projects/p1/chat'
  vi.mocked(useInboxBadge).mockReturnValue({ pending: 6, connected: true, refresh: vi.fn() })
  vi.mocked(useInboxList).mockReturnValue(hook(waiting, { counts: { requests: 6, unread: 9 } }))
})
afterEach(() => vi.clearAllMocks())

describe('InboxBell', () => {
  test('carries how much waits on the reader', () => {
    render(<InboxBell />)
    const bell = screen.getByTestId('inbox-bell')
    expect(bell).toHaveAttribute('href', '/app/inbox')
    expect(bell).toHaveTextContent('6')
    expect(screen.queryByTestId('inbox-glance')).not.toBeInTheDocument()
  })

  test('a plain click opens a glance: the four newest waiting entries, the news count and the way to the page', async () => {
    render(<InboxBell />)
    await userEvent.click(screen.getByTestId('inbox-bell'))
    const glance = await screen.findByTestId('inbox-glance')
    expect(useInboxList).toHaveBeenCalledWith(true, 'requests')
    expect(glance).toHaveTextContent('Waiting for you: 6')
    expect(within(glance).getAllByTestId('inbox-entry').map((entry) => entry.getAttribute('data-item-id'))).toEqual(['f', 'e', 'd', 'c'])
    expect(screen.getByTestId('inbox-glance-news')).toHaveTextContent('News: 9')
    expect(within(glance).getByRole('link', { name: 'Open inbox' })).toHaveAttribute('href', '/app/inbox')
    expect(router.push).not.toHaveBeenCalled()
  })

  test('picking an entry in the glance opens the page on that entry', async () => {
    render(<InboxBell />)
    await userEvent.click(screen.getByTestId('inbox-bell'))
    await userEvent.click((await screen.findAllByTestId('inbox-entry'))[0]!)
    expect(router.push).toHaveBeenCalledWith('/app/inbox?item=f')
  })

  test('on the inbox page it is where the reader is, and a click leads back', async () => {
    page.pathname = '/app/inbox'
    window.history.pushState({}, '', '/app/inbox')
    render(<InboxBell />)
    const bell = screen.getByTestId('inbox-bell')
    expect(bell).toHaveAttribute('aria-current', 'page')
    expect(bell).toHaveAccessibleName('Leave the inbox')
    await userEvent.click(bell)
    expect(router.back).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('inbox-glance')).not.toBeInTheDocument()
  })

  test('leaves a modifier click to the browser, which opens the page in a new tab', () => {
    render(<InboxBell />)
    const notPrevented = fireEvent.click(screen.getByTestId('inbox-bell'), { metaKey: true })
    expect(notPrevented).toBe(true)
    expect(screen.queryByTestId('inbox-glance')).not.toBeInTheDocument()
  })
})

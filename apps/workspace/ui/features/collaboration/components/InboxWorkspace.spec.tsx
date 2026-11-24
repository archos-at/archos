import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test-utils'
import type { InboxItemView, InboxListFilter } from '@/lib/inbox/types'

vi.mock('sonner', () => ({ toast: vi.fn() }))
vi.mock('../hooks/use-inbox', () => ({ useInboxList: vi.fn(), useInboxBadge: vi.fn() }))

const page = vi.hoisted(() => ({ search: '' }))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/app/inbox',
  useSearchParams: () => new URLSearchParams(page.search),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { useInboxList, type UseInboxListResult } from '../hooks/use-inbox'
import { InboxWorkspace } from './InboxWorkspace'

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

const TODAY = '2026-10-29'
const older = row('older', { updatedAt: '2026-10-27T08:00:00Z' })
const newer = row('newer', { updatedAt: '2026-10-28T08:00:00Z' })
const late = row('late', { variant: 'overdue', dueOn: '2026-10-15', updatedAt: '2026-10-20T08:00:00Z' })
const news = row('news', { type: 'conversation.activity', resourceType: 'conversation', resourceId: 'c1', actionable: false, answerIn: null, anchorId: null })
const seen = row('seen', { type: 'conversation.activity', resourceType: 'conversation', resourceId: 'c2', actionable: false, answerIn: null, anchorId: null, read: true, state: 'read' })

let lists: Partial<Record<InboxListFilter, UseInboxListResult>>
const serve = (filter: InboxListFilter, items: InboxItemView[], overrides: Partial<UseInboxListResult> = {}): UseInboxListResult =>
  (lists[filter] = hook(items, { counts: { requests: 3, unread: 1 }, ...overrides }))
const ids = (): (string | null)[] => screen.getAllByTestId('inbox-entry').map((entry) => entry.getAttribute('data-item-id'))

beforeEach(() => {
  page.search = ''
  lists = {}
  vi.mocked(useInboxList).mockImplementation((_enabled, filter) => lists[filter] ?? hook([]))
})
afterEach(() => vi.clearAllMocks())

describe('InboxWorkspace', () => {
  test('has three tabs, and opens on what waits on the reader', () => {
    serve('requests', [older])
    render(<InboxWorkspace today={TODAY} />)
    expect(screen.getByTestId('inbox-tab-waiting')).toHaveTextContent('Waiting on you')
    expect(screen.getByTestId('inbox-tab-news')).toHaveTextContent('News')
    expect(screen.getByTestId('inbox-tab-archived')).toHaveTextContent('Archived')
    expect(useInboxList).toHaveBeenCalledWith(true, 'requests')
    expect(screen.getByTestId('inbox-opened')).toHaveTextContent('Pick an entry on the left.')
  })

  test('keeps overdue entries on top, and the newest first below them', () => {
    serve('requests', [older, late, newer])
    render(<InboxWorkspace today={TODAY} />)
    expect(ids()).toEqual(['late', 'newer', 'older'])
  })

  test('picking an entry puts it in the URL and marks an unread one read', async () => {
    const list = serve('requests', [newer])
    render(<InboxWorkspace today={TODAY} />)
    await userEvent.click(screen.getByTestId('inbox-entry'))
    expect(router.replace).toHaveBeenCalledWith('/app/inbox?item=newer', { scroll: false })
    expect(list.markRead).toHaveBeenCalledWith(['newer'])
  })

  test('leaves an entry the reader has read as it is, and opens the one the URL names beside the list', async () => {
    page.search = 'tab=news&item=seen'
    const list = serve('all', [seen])
    render(<InboxWorkspace today={TODAY} />)
    expect(screen.getByTestId('inbox-entry')).toHaveAttribute('aria-current', 'true')
    expect(within(screen.getByTestId('inbox-opened')).getByTestId('inbox-opened-go')).toHaveAttribute('href', seen.href)
    await userEvent.click(screen.getByTestId('inbox-entry'))
    expect(list.markRead).not.toHaveBeenCalled()
  })

  test('the news tab leaves out the open requests, which have a tab of their own', () => {
    page.search = 'tab=news'
    serve('all', [newer, news, seen])
    render(<InboxWorkspace today={TODAY} />)
    expect(ids()).toEqual(['seen', 'news'])
  })

  test('changing the tab goes to that tab and lets go of the opened entry', async () => {
    page.search = 'item=newer'
    serve('requests', [newer])
    render(<InboxWorkspace today={TODAY} />)
    await userEvent.click(screen.getByTestId('inbox-tab-archived'))
    expect(router.replace).toHaveBeenCalledWith('/app/inbox?tab=archived', { scroll: false })
  })

  test.each([
    ['', 'All caught up'],
    ['tab=news', 'Your inbox is empty'],
    ['tab=archived', 'Nothing archived'],
  ])('says what an empty tab means (%s)', (search, title) => {
    page.search = search
    render(<InboxWorkspace today={TODAY} />)
    expect(screen.getByTestId('inbox-entries')).toHaveTextContent(title)
  })

  test('offers to mark everything read only while something is unread, and never in the archive', async () => {
    page.search = 'tab=news'
    serve('all', [seen])
    const { unmount } = render(<InboxWorkspace today={TODAY} />)
    expect(screen.getByTestId('inbox-mark-all-read')).toBeDisabled()
    unmount()

    const list = serve('all', [news])
    const view = render(<InboxWorkspace today={TODAY} />)
    await userEvent.click(screen.getByTestId('inbox-mark-all-read'))
    expect(list.markAllRead).toHaveBeenCalledTimes(1)
    view.unmount()

    page.search = 'tab=archived'
    render(<InboxWorkspace today={TODAY} />)
    expect(screen.queryByTestId('inbox-mark-all-read')).not.toBeInTheDocument()
  })
})

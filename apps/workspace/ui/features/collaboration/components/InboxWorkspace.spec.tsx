import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { act, render, screen, waitFor, within } from '@/test-utils'
import { getAnnotation } from '@/lib/annotations/client'
import type { AnnotationView } from '@/lib/annotations/types'
import type { InboxItemView, InboxListFilter } from '@/lib/inbox/types'

vi.mock('sonner', () => ({ toast: vi.fn() }))
vi.mock('../hooks/use-inbox', () => ({ useInboxList: vi.fn(), useInboxBadge: vi.fn() }))
vi.mock('@/lib/annotations/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/annotations/client')>()),
  getAnnotation: vi.fn(),
}))
vi.mock('@/features/knowledge/components/page-region-thumbnail', () => ({ PageRegionThumbnail: () => null }))

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
import type { InboxMarkClient } from '../hooks/use-mark-answer'
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
    archiveAll: vi.fn(async () => '2026-11-24T10:00:00.000Z'),
    unarchiveAll: vi.fn(async () => true),
    archive: vi.fn(async () => {}),
    unarchive: vi.fn(async () => true),
    ...overrides,
  }
}

const older = row('older', { updatedAt: '2026-10-27T08:00:00Z' })
const newer = row('newer', { updatedAt: '2026-10-28T08:00:00Z' })
const late = row('late', { variant: 'overdue', dueOn: '2026-10-15', updatedAt: '2026-10-20T08:00:00Z' })
const news = row('news', { type: 'conversation.activity', resourceType: 'conversation', resourceId: 'c1', actionable: false, answerIn: null, anchorId: null })
const seen = row('seen', { type: 'conversation.activity', resourceType: 'conversation', resourceId: 'c2', actionable: false, answerIn: null, anchorId: null, read: true, state: 'read' })

let lists: Partial<Record<InboxListFilter, UseInboxListResult>>
const serve = (filter: InboxListFilter, items: InboxItemView[], overrides: Partial<UseInboxListResult> = {}): UseInboxListResult =>
  (lists[filter] = hook(items, { counts: { requests: 3, unread: 1 }, ...overrides }))
const ids = (): (string | null)[] => screen.getAllByTestId('inbox-entry').map((entry) => entry.getAttribute('data-item-id'))
const current = (): string | null | undefined =>
  screen.getAllByTestId('inbox-entry').find((entry) => entry.getAttribute('aria-current') === 'true')?.getAttribute('data-item-id')

const annotation = (documentId: string, id: string): AnnotationView =>
  ({ id, documentId, number: 4, page: 1, shape: 'point', x: 0.5, y: 0.5, w: null, h: null, status: 'open', onCurrentRevision: true, revisionNumber: 1, body: `Body of ${id}`, mentions: [], replies: [] }) as unknown as AnnotationView
const markClient = (): InboxMarkClient => ({
  reply: vi.fn(async (documentId: string, id: string) => ({ annotation: annotation(documentId, id), replyId: 'r1', wake: 'none' }) as never),
  update: vi.fn(async () => ({}) as never),
})
const onDocument = (id: string, documentId: string, overrides: Partial<InboxItemView> = {}): InboxItemView =>
  row(id, { resourceId: documentId, href: `/app/projects/p1/files?doc=${documentId}&review=1&mark=mark-${id}`, ...overrides })
const followTheUrl = (): void => {
  router.replace.mockImplementation((url: string) => {
    page.search = url.split('?')[1] ?? ''
  })
}

beforeEach(() => {
  page.search = ''
  lists = {}
  router.replace.mockImplementation(() => {})
  vi.mocked(useInboxList).mockImplementation((_enabled, filter) => lists[filter] ?? hook([]))
  vi.mocked(getAnnotation).mockImplementation(async (documentId, id) => annotation(documentId, id))
})
afterEach(() => vi.clearAllMocks())

describe('InboxWorkspace', () => {
  test('has three tabs, and opens on what waits on the reader', () => {
    serve('requests', [older])
    render(<InboxWorkspace />)
    expect(screen.getByTestId('inbox-tab-waiting')).toHaveTextContent('Waiting on you')
    expect(screen.getByTestId('inbox-tab-news')).toHaveTextContent('News')
    expect(screen.getByTestId('inbox-tab-archived')).toHaveTextContent('Archived')
    expect(useInboxList).toHaveBeenCalledWith(true, 'requests')
  })

  test('shows the newest entry beside the list before anything is picked, and leaves it unread', async () => {
    const list = serve('requests', [older, newer])
    render(<InboxWorkspace />)
    expect(screen.getAllByTestId('inbox-entry')[0]).toHaveAttribute('aria-current', 'true')
    expect(await within(screen.getByTestId('inbox-opened')).findByText('Body of mark-newer')).toBeInTheDocument()
    expect(getAnnotation).toHaveBeenCalledWith('doc-eg', 'mark-newer')
    expect(list.markRead).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  test('keeps overdue entries on top, and the newest first below them', () => {
    serve('requests', [older, late, newer])
    render(<InboxWorkspace />)
    expect(ids()).toEqual(['late', 'newer', 'older'])
  })

  test('picking an entry puts it in the URL and marks an unread one read', async () => {
    const list = serve('requests', [newer])
    render(<InboxWorkspace />)
    await userEvent.click(screen.getByTestId('inbox-entry'))
    expect(router.replace).toHaveBeenCalledWith('/app/inbox?item=newer', { scroll: false })
    expect(list.markRead).toHaveBeenCalledWith(['newer'])
  })

  test('leaves an entry the reader has read as it is, and opens the one the URL names beside the list', async () => {
    page.search = 'tab=news&item=seen'
    const list = serve('all', [seen])
    render(<InboxWorkspace />)
    expect(screen.getByTestId('inbox-entry')).toHaveAttribute('aria-current', 'true')
    expect(within(screen.getByTestId('inbox-opened')).getByTestId('inbox-opened-go')).toHaveAttribute('href', seen.href)
    await userEvent.click(screen.getByTestId('inbox-entry'))
    expect(list.markRead).not.toHaveBeenCalled()
  })

  test('the news tab leaves out the open requests, which have a tab of their own', () => {
    page.search = 'tab=news'
    serve('all', [newer, news, seen])
    render(<InboxWorkspace />)
    expect(ids()).toEqual(['seen', 'news'])
  })

  test('changing the tab goes to that tab and lets go of the opened entry', async () => {
    page.search = 'item=newer'
    serve('requests', [newer])
    render(<InboxWorkspace />)
    await userEvent.click(screen.getByTestId('inbox-tab-archived'))
    expect(router.replace).toHaveBeenCalledWith('/app/inbox?tab=archived', { scroll: false })
  })

  test.each([
    ['', 'All caught up'],
    ['tab=news', 'Your inbox is empty'],
    ['tab=archived', 'Nothing archived'],
  ])('says what an empty tab means (%s)', (search, title) => {
    page.search = search
    render(<InboxWorkspace />)
    expect(screen.getByTestId('inbox-entries')).toHaveTextContent(title)
  })

  test('empties the inbox even when every open request is already read, and never offers it in the archive', async () => {
    const empty = serve('requests', [], { pending: 0, counts: { requests: 0, unread: 0 } })
    const { unmount } = render(<InboxWorkspace />)
    expect(screen.getByTestId('inbox-archive-all')).toBeDisabled()
    expect(empty.archiveAll).not.toHaveBeenCalled()
    unmount()

    const list = serve('requests', [{ ...newer, read: true }, { ...older, read: true }], { counts: { requests: 2, unread: 0 } })
    const view = render(<InboxWorkspace />)
    await userEvent.click(screen.getByTestId('inbox-archive-all'))
    expect(list.archiveAll).toHaveBeenCalledTimes(1)
    view.unmount()

    page.search = 'tab=archived'
    serve('archived', [{ ...news, archived: true }])
    render(<InboxWorkspace />)
    expect(screen.getByTestId('inbox-archive-all')).toBeDisabled()
    expect(screen.getByTestId('inbox-archive-all')).toHaveAttribute('aria-hidden', 'true')
  })

  test('„Undo“ on the toast brings back exactly what „Alle archivieren“ put away', async () => {
    const list = serve('requests', [{ ...newer, read: true }])
    render(<InboxWorkspace />)
    await userEvent.click(screen.getByTestId('inbox-archive-all'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Inbox cleared', expect.anything()))
    const { action } = vi.mocked(toast).mock.calls.at(-1)?.[1] ?? {}
    if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('the toast offers no undo')
    act(() => action.onClick({} as never))
    expect(list.unarchiveAll).toHaveBeenCalledWith('2026-11-24T10:00:00.000Z')
  })

  test.each([
    ['', 'requests', true],
    ['tab=news', 'all', true],
    ['tab=archived', 'archived', false],
  ] as const)('keeps „Archive all“ in its place on every tab, so the tabs never move (%s)', (search, filter, usable) => {
    page.search = search
    serve(filter, [{ ...news, archived: filter === 'archived' }])
    render(<InboxWorkspace />)
    const button = screen.getByTestId('inbox-archive-all')
    if (usable) expect(button).toBeEnabled()
    else expect(button).toBeDisabled()
  })

  test('an empty tab says so across the whole width, with no opened pane beside it', () => {
    serve('requests', [])
    render(<InboxWorkspace />)
    expect(screen.getByTestId('inbox-entries')).toHaveTextContent('All caught up')
    expect(screen.queryByTestId('inbox-opened')).not.toBeInTheDocument()
  })

  test('J steps to the next entry, U marks the opened one unread again, E archives it', async () => {
    page.search = 'item=newer'
    const list = serve('requests', [{ ...newer, read: true }, older])
    render(<InboxWorkspace />)

    await userEvent.keyboard('u')
    expect(list.markUnread).toHaveBeenCalledWith(['newer'])

    await userEvent.keyboard('j')
    expect(router.replace).toHaveBeenCalledWith('/app/inbox?item=older', { scroll: false })

    await userEvent.keyboard('e')
    expect(ids()).toEqual(['older'])
  })

  test('an annotation assigned to the reader can be marked as done from the opened entry, and opens in the review view', async () => {
    serve('requests', [{ ...newer, type: 'annotation.assigned_to_you', answerIn: 'row', anchorId: 'mark-1', href: '/app/projects/p1/files/d1?mark=mark-1' }])
    render(<InboxWorkspace />)
    expect(await screen.findByTestId('inbox-opened-done')).toHaveTextContent('Mark as done')
    expect(screen.getByTestId('inbox-opened-go')).toHaveTextContent('Open in the review view')
    expect(screen.getByTestId('inbox-opened-archive')).toHaveTextContent('Archive')
  })

  test('archiving the opened entry opens the one that slides into its place', async () => {
    followTheUrl()
    page.search = 'item=b'
    const list = serve('requests', [
      onDocument('a', 'doc-1', { updatedAt: '2026-10-29T08:00:00Z' }),
      onDocument('b', 'doc-2', { updatedAt: '2026-10-28T08:00:00Z' }),
      onDocument('c', 'doc-3', { updatedAt: '2026-10-27T08:00:00Z' }),
    ])
    render(<InboxWorkspace />)
    await userEvent.click(screen.getByTestId('inbox-opened-archive'))
    expect(router.replace).toHaveBeenLastCalledWith('/app/inbox?item=c', { scroll: false })
    expect(list.markRead).toHaveBeenCalledWith(['c'])
    expect(ids()).toEqual(['a', 'c'])
    expect(current()).toBe('c')
  })

  test('marking the opened entry done holds the write for the undo, and opens the next mark on the same document', async () => {
    followTheUrl()
    page.search = 'item=x'
    const marks = markClient()
    const list = serve('requests', [
      onDocument('x', 'doc-1', { updatedAt: '2026-10-29T08:00:00Z' }),
      onDocument('y', 'doc-2', { updatedAt: '2026-10-28T08:00:00Z' }),
      onDocument('z', 'doc-1', { updatedAt: '2026-10-27T08:00:00Z' }),
    ])
    const view = render(<InboxWorkspace markClient={marks} />)
    await userEvent.click(await screen.findByTestId('inbox-opened-done'))

    expect(router.replace).toHaveBeenLastCalledWith('/app/inbox?item=z', { scroll: false })
    expect(ids()).toEqual(['y', 'z'])
    expect(current()).toBe('z')
    expect(toast).toHaveBeenCalledWith('Marked as resolved.', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }))
    expect(marks.update).not.toHaveBeenCalled()

    view.unmount()
    await waitFor(() => expect(marks.update).toHaveBeenCalledWith('doc-1', 'mark-x', { status: 'resolved', expectedStatus: 'open' }))
    await waitFor(() => expect(list.refresh).toHaveBeenCalled())
  })

  test('„Undo“ on the toast brings the resolved entry back and writes nothing', async () => {
    const marks = markClient()
    serve('requests', [onDocument('x', 'doc-1')])
    const view = render(<InboxWorkspace markClient={marks} />)
    await userEvent.click(await screen.findByTestId('inbox-opened-done'))
    expect(screen.queryByTestId('inbox-entry')).not.toBeInTheDocument()

    const { action } = vi.mocked(toast).mock.calls.at(-1)?.[1] ?? {}
    if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('the toast offers no undo')
    act(() => action.onClick(new MouseEvent('click') as never))
    expect(ids()).toEqual(['x'])
    view.unmount()
    expect(marks.update).not.toHaveBeenCalled()
  })

  test('an answered question of the agent leaves „Waiting on you“, and the next entry opens', async () => {
    followTheUrl()
    page.search = 'item=ask'
    const marks = markClient()
    const list = serve('requests', [
      onDocument('ask', 'doc-1', { type: 'agent.asks_you', actorName: null, actorUserId: null, updatedAt: '2026-10-29T08:00:00Z' }),
      onDocument('other', 'doc-2', { updatedAt: '2026-10-28T08:00:00Z' }),
    ])
    render(<InboxWorkspace markClient={marks} />)
    await userEvent.type(await screen.findByTestId('inbox-opened-reply'), 'Ja, 1,00 m.')
    await userEvent.click(screen.getByTestId('inbox-opened-reply-send'))

    await waitFor(() => expect(ids()).toEqual(['other']))
    expect(marks.reply).toHaveBeenCalledWith('doc-1', 'mark-ask', { body: 'Ja, 1,00 m.' })
    expect(router.replace).toHaveBeenLastCalledWith('/app/inbox?item=other', { scroll: false })
    expect(list.refresh).toHaveBeenCalled()
  })

  test('an answered assignment stays where it waits: answering is not resolving', async () => {
    const marks = markClient()
    serve('requests', [onDocument('task', 'doc-1'), onDocument('other', 'doc-2', { updatedAt: '2026-10-28T08:00:00Z' })])
    render(<InboxWorkspace markClient={marks} />)
    await userEvent.type(await screen.findByTestId('inbox-opened-reply'), 'Ist bestellt.')
    await userEvent.click(screen.getByTestId('inbox-opened-reply-send'))

    await waitFor(() => expect(marks.reply).toHaveBeenCalled())
    expect(ids()).toEqual(['task', 'other'])
    expect(router.replace).not.toHaveBeenCalled()
  })

  test('R puts the cursor in the reply box', async () => {
    serve('requests', [onDocument('x', 'doc-1')])
    render(<InboxWorkspace markClient={markClient()} />)
    const reply = await screen.findByTestId('inbox-opened-reply')
    await userEvent.keyboard('r')
    expect(reply).toHaveFocus()
  })
})

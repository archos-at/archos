import { describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test-utils'
import type { InboxItemView } from '@/lib/inbox/types'
import { InboxEntry } from './InboxEntry'

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

describe('InboxEntry', () => {
  test('reads what is asked, in which project, and that an overdue request is overdue', () => {
    render(<InboxEntry item={row('late', { excerpt: 'Parapet too low', variant: 'overdue', dueOn: '2026-10-15' })} onPick={vi.fn()} />)
    expect(screen.getByTestId('inbox-entry-title')).toHaveTextContent('Parapet too low')
    expect(screen.getByTestId('inbox-entry-project')).toHaveTextContent('Linzer Strasse housing')
    expect(screen.getByTestId('inbox-entry-due')).toHaveTextContent('Overdue')
    expect(screen.getByTestId('inbox-entry')).toHaveTextContent('Assigned by Anna Weber')
  })

  test('says „Personal“ for an entry that belongs to no project, and has no due label without a date', () => {
    render(<InboxEntry item={row('a', { projectName: null })} onPick={vi.fn()} />)
    expect(screen.getByTestId('inbox-entry-project')).toHaveTextContent('Personal')
    expect(screen.queryByTestId('inbox-entry-due')).not.toBeInTheDocument()
  })

  test.each([
    ['names the document after the project', {}, 'Linzer Strasse housing · Ground floor plan'],
    ['names the document after „Personal“ outside a project', { projectName: null }, 'Personal · Ground floor plan'],
    ['leaves the document out when it is the project', { subject: 'Linzer Strasse housing' }, 'Linzer Strasse housing'],
    ['leaves the document out when the excerpt names it', { excerpt: 'Ground floor plan: door too narrow' }, 'Linzer Strasse housing'],
    ['leaves the document out when the sentence names it', { type: 'annotation.activity', actionable: false, answerIn: null, excerpt: null }, 'Linzer Strasse housing'],
  ] as const)('the place line %s', (_, overrides: Partial<InboxItemView>, place) => {
    render(<InboxEntry item={row('a', overrides)} onPick={vi.fn()} />)
    expect(screen.getByTestId('inbox-entry-project').textContent).toBe(place)
  })

  test('says who it is from: the reason, else the sentence an excerpt took the place of, else who did it', () => {
    const { unmount } = render(<InboxEntry item={row('a')} onPick={vi.fn()} />)
    expect(screen.getByTestId('inbox-entry-from').textContent).toBe('Assigned by Anna Weber · Annotation 4')
    unmount()

    const news = { type: 'annotation.activity', actionable: false, answerIn: null } as const
    const { unmount: away } = render(<InboxEntry item={row('b', { ...news, excerpt: 'Ist bestellt.' })} onPick={vi.fn()} />)
    expect(screen.getByTestId('inbox-entry-title').textContent).toBe('Ist bestellt.')
    expect(screen.getByTestId('inbox-entry-from').textContent).toBe('Anna Weber replied on annotation 4 in “Ground floor plan”')
    away()

    render(<InboxEntry item={row('c', { ...news, excerpt: null })} onPick={vi.fn()} />)
    expect(screen.getByTestId('inbox-entry-title').textContent).toBe('Anna Weber replied on annotation 4 in “Ground floor plan”')
    expect(screen.getByTestId('inbox-entry-from').textContent).toBe('Anna Weber')
  })

  test('hands the entry to whoever picks it, and marks the one that is open', async () => {
    const onPick = vi.fn()
    const item = row('a')
    render(<InboxEntry item={item} current onPick={onPick} />)
    const entry = screen.getByTestId('inbox-entry')
    expect(entry).toHaveAttribute('aria-current', 'true')
    await userEvent.click(entry)
    expect(onPick).toHaveBeenCalledWith(item)
  })
})

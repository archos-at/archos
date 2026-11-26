import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { render, screen, waitFor, within } from '@/test-utils'
import { I18nProvider } from '@/i18n'
import { PRODUCT_NAME } from '@/lib/brand'
import { annotationReplyViewSchema, type AnnotationReplyView, type AnnotationView } from '@/lib/annotations/types'
import type { InboxItemView } from '@/lib/inbox/types'
import type { PagePlace } from '@/features/knowledge/lib/page-place'
import type { InboxMarkClient } from '../hooks/use-mark-answer'
import { InboxOpened, type InboxOpenedProps } from './InboxOpened'

vi.mock('sonner', () => ({ toast: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/app/inbox',
  useSearchParams: () => new URLSearchParams('item=i1'),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/features/knowledge/components/page-region-thumbnail', () => ({
  PageRegionThumbnail: ({ place }: { place: PagePlace }) => (
    <span data-testid="inbox-mark-crop" data-document={place.document.id} data-page={place.page} data-region={place.region?.join(',')} />
  ),
}))

const HREF = '/app/projects/p1/files?doc=doc-eg&review=1&mark=mark-4'
const BACK = `${HREF}&back=${encodeURIComponent('/app/inbox?item=i1')}`

const entry = (overrides: Partial<InboxItemView> = {}): InboxItemView => ({
  id: 'i1',
  type: 'annotation.assigned_to_you',
  state: 'unread',
  archived: false,
  read: false,
  actionable: true,
  resourceType: 'document',
  resourceId: 'doc-eg',
  anchorId: 'mark-4',
  actorName: 'Anna Weber',
  actorUserId: 'u-anna',
  count: 1,
  href: HREF,
  subject: 'Grundriss EG',
  projectName: 'Wohnbau Linzer Straße',
  related: '4',
  excerpt: 'Türbreite prüfen',
  mentions: [],
  variant: null,
  answerIn: 'row',
  createdAt: '2026-10-29T08:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
  ...overrides,
})

const reply = (id: string, body: string, overrides: Partial<AnnotationReplyView> = {}): AnnotationReplyView =>
  annotationReplyViewSchema.parse({
    id,
    annotationId: 'mark-4',
    authorKind: 'person',
    body,
    createdBy: 'u-anna',
    createdByName: 'Anna Weber',
    createdAt: '2026-10-29T09:00:00Z',
    mentions: [],
    editedAt: null,
    ...overrides,
  })

const annotation = (overrides: Partial<AnnotationView> = {}): AnnotationView => ({
  id: 'mark-4',
  documentId: 'doc-eg',
  number: 4,
  page: 2,
  shape: 'region',
  x: 0.25,
  y: 0.5,
  w: 0.125,
  h: 0.25,
  kind: 'defect',
  body: 'Tür im Flur ist zu schmal',
  basis: null,
  authorKind: 'person',
  status: 'open',
  assigneeUserId: 'u-me',
  assigneeName: 'Miriam Hofer',
  dueOn: null,
  revisionNumber: 3,
  onCurrentRevision: true,
  createdBy: 'u-anna',
  createdByName: 'Anna Weber',
  createdAt: '2026-10-29T08:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
  acceptedBy: null,
  acceptedByName: null,
  closedBy: null,
  closedByName: null,
  closedAt: null,
  delegatedBy: null,
  delegatedByName: null,
  delegatedAt: null,
  replies: [reply('r1', 'Bitte bis Freitag klären.')],
  canEdit: true,
  canDelete: false,
  ...overrides,
})

const loading = (mark: AnnotationView = annotation()) => vi.fn(async () => mark)
const refusing = () => vi.fn(async (): Promise<AnnotationView> => Promise.reject(new Error('503')))

function open(item: InboxItemView, props: Partial<InboxOpenedProps> = {}) {
  const handlers = { onArchive: vi.fn(), onUnarchive: vi.fn(), onResolve: vi.fn(), onAnswered: vi.fn(), onPick: vi.fn() }
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <InboxOpened item={item} {...handlers} {...props} />
    </I18nProvider>
  )
  return handlers
}

describe('InboxOpened — an entry about a mark', () => {
  test('loads the mark and shows its place on the plan and its thread', async () => {
    const loadMark = loading()
    open(entry(), { loadMark })
    const place = await screen.findByTestId('inbox-mark-place')
    expect(loadMark).toHaveBeenCalledWith('doc-eg', 'mark-4')
    expect(place).toHaveAttribute('href', BACK)
    expect(place).toHaveTextContent('Grundriss EG · Seite 2')
    const crop = within(place).getByTestId('inbox-mark-crop')
    expect(crop).toHaveAttribute('data-document', 'doc-eg')
    expect(crop).toHaveAttribute('data-page', '2')
    expect(crop).toHaveAttribute('data-region', '0.25,0.5,0.125,0.25')
    expect(screen.getByTestId('inbox-opened-title')).toHaveTextContent('Tür im Flur ist zu schmal')
    const thread = screen.getByTestId('inbox-mark-thread')
    expect(thread).toHaveTextContent('Anna Weber')
    expect(thread).toHaveTextContent('Bitte bis Freitag klären.')
  })

  test('the reply box answers through the mark client, says so, shows the reply and hands the entry on', async () => {
    const sent = annotation({ replies: [reply('r1', 'Bitte bis Freitag klären.'), reply('r2', 'Ist bestellt.', { createdByName: 'Miriam Hofer' })] })
    const markClient: InboxMarkClient = { reply: vi.fn(async () => ({ annotation: sent, replyId: 'r2', wake: 'none' }) as never), update: vi.fn() }
    const item = entry()
    const { onAnswered } = open(item, { loadMark: loading(), markClient })
    await userEvent.type(await screen.findByLabelText('Ihre Antwort auf Anmerkung 4'), '  Ist bestellt.  ')
    await userEvent.click(screen.getByTestId('inbox-opened-reply-send'))
    await waitFor(() => expect(onAnswered).toHaveBeenCalledWith(item))
    expect(markClient.reply).toHaveBeenCalledWith('doc-eg', 'mark-4', { body: 'Ist bestellt.' })
    expect(toast).toHaveBeenCalledWith('Antwort gesendet.', undefined)
    expect(screen.getByTestId('inbox-mark-thread')).toHaveTextContent('Ist bestellt.')
  })

  test('offers no reply box once the mark is settled', async () => {
    open(entry(), { loadMark: loading(annotation({ status: 'resolved' })) })
    await screen.findByTestId('inbox-mark-place')
    expect(screen.queryByTestId('inbox-opened-reply')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inbox-opened-done')).not.toBeInTheDocument()
  })

  test('„Als erledigt markieren“ hands an assignment to whoever resolves it', async () => {
    const item = entry()
    const { onResolve } = open(item, { loadMark: loading() })
    await userEvent.click(await screen.findByTestId('inbox-opened-done'))
    expect(onResolve).toHaveBeenCalledWith(item)
  })

  test.each([['annotation.mentioned'], ['agent.asks_you']] as const)('offers no „Als erledigt markieren“ for %s: being asked is not being responsible', async (type) => {
    open(entry({ type }), { loadMark: loading() })
    expect(await screen.findByTestId('inbox-opened-reply')).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-opened-done')).not.toBeInTheDocument()
  })

  test('a news entry about a mark keeps its own sentence and explains itself above the crop', async () => {
    const item = entry({ type: 'agent.work_failed', actionable: false, answerIn: null, actorName: null, actorUserId: null })
    open(item, { loadMark: loading() })
    const place = await screen.findByTestId('inbox-mark-place')
    expect(screen.getByTestId('inbox-opened-title')).toHaveTextContent('Tür im Flur ist zu schmal')
    expect(screen.getByTestId('inbox-opened-entry')).toHaveTextContent(`${PRODUCT_NAME} konnte Anmerkung 4 in „Grundriss EG“ nicht bearbeiten`)
    const body = screen.getByText(`Öffnen Sie die Anmerkung: Bitten Sie ${PRODUCT_NAME} noch einmal darum oder bearbeiten Sie sie selbst.`)
    expect(body.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByTestId('inbox-opened-reply')).not.toBeInTheDocument()
  })

  test('a mark that fails to load says so, and the entry can still be archived and opened in the review', async () => {
    const { onArchive } = open(entry(), { loadMark: refusing() })
    expect(await screen.findByText('Die Anmerkung konnte nicht geladen werden. Öffnen Sie sie in der Prüfansicht.')).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-opened-reply')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inbox-opened-done')).not.toBeInTheDocument()
    expect(screen.getByTestId('inbox-opened-go')).toHaveTextContent('In der Prüfansicht öffnen')
    await userEvent.click(screen.getByTestId('inbox-opened-archive'))
    expect(onArchive).toHaveBeenCalledWith('i1')
  })

  test('points to the next entry on the same document', async () => {
    const next = entry({ id: 'i2', anchorId: 'mark-5' })
    const { onPick } = open(entry(), { loadMark: loading(), sameDocument: { next, remaining: 2 } })
    await userEvent.click(screen.getByTestId('inbox-opened-next-here'))
    expect(screen.getByTestId('inbox-opened-next-here')).toHaveTextContent('Noch 2 in diesem Dokument')
    expect(onPick).toHaveBeenCalledWith(next)
  })
})

describe('InboxOpened — the way on', () => {
  test.each([
    ['an entry answered in the review', entry({ answerIn: 'review' }), 'In der Prüfansicht beantworten', BACK],
    ['an entry about a mark', entry(), 'In der Prüfansicht öffnen', BACK],
    [
      'any other entry',
      entry({ type: 'upload.completed', resourceType: 'upload_batch', resourceId: 'b1', anchorId: null, href: '/app/uploads/b1', answerIn: null }),
      'Öffnen',
      '/app/uploads/b1',
    ],
  ])('%s reads its own label', async (_, item, label, href) => {
    open(item, { loadMark: loading() })
    await waitFor(() => expect(screen.getByTestId('inbox-opened-go')).toHaveTextContent(label))
    expect(screen.getByTestId('inbox-opened-go')).toHaveAttribute('href', href)
  })
})

describe('InboxOpened — an entry about anything else', () => {
  test('shows what the entry says, loads no mark and offers no reply box', () => {
    const loadMark = loading()
    const upload = entry({
      type: 'upload.completed',
      resourceType: 'upload_batch',
      resourceId: 'b1',
      anchorId: null,
      href: '/app/uploads/b1',
      subject: 'Wohnbau Nord',
      excerpt: null,
      actorName: null,
      actorUserId: null,
      actionable: false,
      answerIn: null,
    })
    open(upload, { loadMark })
    expect(screen.getByTestId('inbox-opened-title')).toHaveTextContent('Ihr Upload ist gelesen')
    expect(screen.getByTestId('inbox-opened-body')).toHaveTextContent('Wohnbau Nord: Öffnen Sie die Übersicht, um zu sehen, was angekommen ist.')
    expect(loadMark).not.toHaveBeenCalled()
    expect(screen.queryByTestId('inbox-mark-place')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inbox-opened-reply')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inbox-opened-done')).not.toBeInTheDocument()
  })

  test('an archived entry offers to restore it', async () => {
    const { onUnarchive, onArchive } = open(entry({ type: 'upload.completed', resourceType: 'upload_batch', anchorId: null, href: '/app/uploads/b1', archived: true }))
    await userEvent.click(screen.getByTestId('inbox-opened-archive'))
    expect(screen.getByTestId('inbox-opened-archive')).toHaveTextContent('Wiederherstellen')
    expect(onUnarchive).toHaveBeenCalledWith('i1')
    expect(onArchive).not.toHaveBeenCalled()
  })
})

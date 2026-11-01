/**
 * A Skizze in the Files preview (migration 0192, ADR-0148): its Anmerkungen
 * drawn over its one sheet as a PDF page's are, and its review the same
 * `DocumentReviewMode` as every document, with the diagrams feature's stage
 * (its canvas) where the PDF's pages would be. So a link with
 * `?review=1&mark=` (the Postfach, a mention, a search hit) opens that shell
 * at the mark, with the preview's own review, and so does a phone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import type { AnnotationView } from '@/lib/annotations/types'
import { PreviewSlotsProvider, type ReviewStageProps } from '../preview-actions'
import type { DocumentReview } from '../hooks/use-document-review'
import { FilePreviewPane } from './file-preview-pane'

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/projects/proj-1/files',
  useSearchParams: () => nav.params,
}))
/** The shell as a stand-in: what the pane hands it, and the stage it is given, drawn in its place. */
const shell = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('./review/document-review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DocumentReviewMode: (props: {
    open: boolean
    review: DocumentReview
    focusRequest?: { annotationId: string | null } | null
    stage?: ((slots: { headerSlot: null; setCloseGuard: () => void; close: () => void }) => unknown) | null
  }) => {
    shell.props = props
    if (!props.open) return null
    return (
      <div data-testid="review-mode" data-mark={props.focusRequest?.annotationId ?? ''}>
        {props.stage?.({ headerSlot: null, setCloseGuard: () => {}, close: () => {} }) as never}
      </div>
    )
  },
}))

const SKETCH = {
  id: 'doc-svg',
  filename: 'Stiege.svg',
  displayName: null,
  fileSize: 2048,
  contentType: 'image/svg+xml',
  authoredBy: 'agent' as const,
  status: 'ready',
  folderId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  errorMessage: null,
  summary: null,
  pageCount: null,
  chunkCount: null,
  contentTypes: null,
  tags: null,
  topics: null,
  capture: null,
}

const pinned = {
  id: 'ann-1',
  documentId: 'doc-svg',
  number: 1,
  page: 1,
  shape: 'region',
  x: 0.1,
  y: 0.1,
  w: 0.3,
  h: 0.2,
  elementIds: ['stair'],
  anchorLost: false,
  kind: 'hint',
  body: 'Breite prüfen',
  basis: null,
  authorKind: 'person',
  status: 'open',
  assigneeUserId: null,
  assigneeName: null,
  dueOn: null,
  revisionNumber: 2,
  onCurrentRevision: true,
  createdBy: 'user_anna',
  createdByName: 'Anna Berger',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  acceptedBy: null,
  acceptedByName: null,
  closedBy: null,
  closedByName: null,
  closedAt: null,
  delegatedBy: null,
  delegatedByName: null,
  delegatedAt: null,
  replies: [],
  canEdit: true,
  canDelete: true,
} satisfies AnnotationView

const json = (body: unknown, status = 200): Response => ({ ok: status < 400, status, json: async () => body }) as Response

let restoreLayout = () => {}
beforeEach(() => {
  restoreLayout = installLayoutObservers({ frameWidth: 800, intersecting: true })
  nav.params = new URLSearchParams('doc=doc-svg')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/annotations')) return json({ annotations: [pinned], canAnnotate: true, pilotiWakes: false })
    if (url.endsWith('/preview')) return json({ url: 'https://example.test/stiege.svg' })
    return json({}, 404)
  })
})
afterEach(() => {
  restoreLayout()
  vi.restoreAllMocks()
})

const staged: ReviewStageProps[] = []
function RecordingStage(props: ReviewStageProps) {
  staged.push(props)
  return <div data-testid="sketch-stage" data-document={props.documentId} />
}

const pane = () => (
  <PreviewSlotsProvider stage={RecordingStage}>
    <FilePreviewPane file={SKETCH} projectId="proj-1" />
  </PreviewSlotsProvider>
)

const original = window.matchMedia
/** Pretend to be a phone: below `sm`. */
const phone = () => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('40rem'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia
}
afterEach(() => {
  window.matchMedia = original
  staged.length = 0
})

describe('a Skizze in the Files preview', () => {
  it('draws its marks over its sheet', async () => {
    render(pane())
    const sheet = await screen.findByTestId('sketch-sheet')
    await waitFor(() => expect(sheet.querySelector('[data-testid="review-layer-1"]')).not.toBeNull())
  })

  it('opens a review link in the review shell at its mark, the canvas as its stage', async () => {
    nav.params = new URLSearchParams('doc=doc-svg&review=1&mark=ann-1')
    render(pane())
    const shellNode = await screen.findByTestId('review-mode')
    expect(shellNode.dataset.mark).toBe('ann-1')
    expect(within(shellNode).getByTestId('sketch-stage').dataset.document).toBe('doc-svg')
    // The stage draws with the preview's review: one instance, one room.
    await waitFor(() => expect(staged.at(-1)?.review.annotations.map((mark) => mark.id)).toEqual(['ann-1']))
    expect(staged.at(-1)?.review).toBe((shell.props as { review: DocumentReview }).review)
  })

  it('mounts the review on a phone too: the reader bar’s way in reaches the canvas', async () => {
    phone()
    nav.params = new URLSearchParams('doc=doc-svg&review=1')
    render(pane())
    expect(await screen.findByTestId('file-reader-header')).toBeInTheDocument()
    expect(within(await screen.findByTestId('review-mode')).getByTestId('sketch-stage')).toBeInTheDocument()
  })

  it('opens no review without the diagrams feature’s stage: there is nothing to draw it with', async () => {
    nav.params = new URLSearchParams('doc=doc-svg&review=1')
    render(<FilePreviewPane file={SKETCH} projectId="proj-1" />)
    await screen.findByTestId('sketch-sheet')
    expect(screen.queryByTestId('review-mode')).toBeNull()
  })
})

/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/upload-batches/settle', () => ({ onDocumentsSettled: vi.fn().mockResolvedValue(undefined) }))

const captureServer = vi.hoisted(() => vi.fn(() => true))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer, getPosthogServer: () => null }))

vi.mock('./shelf-live', () => ({ publishShelfChanged: vi.fn() }))

vi.mock('@/lib/search/facets-projector', () => ({ projectReadings: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/search/facets-repository', () => ({ listCollectionDocumentsForProjection: vi.fn().mockResolvedValue([]) }))

const findIngestAnnouncementFacts = vi.hoisted(() => vi.fn(async () => new Map<string, { attempt: number | null; uploadBatchId: string | null }>()))
vi.mock('./repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repository')>()),
  findIngestAnnouncementFacts,
}))

import { onDocumentsSettled } from '@/lib/upload-batches/settle'
import { publishShelfChanged } from './shelf-live'
import { makeDbMock, makeRow, mockFetch, batchResponse, collectionResponse } from './reconcile-status.fixtures'
import { reconcileDocumentStatuses, clearCollectionFilesCache, type ReconcilableDocument } from './reconcile-status'

describe('reconcileDocumentStatuses reports finished ingests to PostHog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const backend = (job: unknown) =>
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('/v1/documents/status/batch')
        ? batchResponse({ 'job-1': job })
        : collectionResponse([
            { file_id: 'f-1', file_name: 'plan.pdf', status: 'success', chunk_count: 12, metadata: { page_count: 4 } },
          ])
    )

  it('sends document_ingest_finished for the row this read moved, with counts and no filename', async () => {
    makeDbMock()
    backend({ status: 'completed', file_details: [{ file_name: 'plan.pdf', status: 'success', screening: 'clean' }] })
    const dispatched = new Date(Date.now() - 120_000)

    await reconcileDocumentStatuses([makeRow({ updatedAt: dispatched })], 'org-1', 'read')

    expect(captureServer).toHaveBeenCalledTimes(1)
    const [[sent]] = captureServer.mock.calls as unknown as [[{ properties: Record<string, unknown> }]]
    expect(sent).toMatchObject({
      event: 'document_ingest_finished',
      distinctId: null,
      organizationId: 'org-1',
      properties: { status: 'completed', screening: 'clean', file_type: 'pdf', page_count: 4, chunk_count: 12 },
    })
    expect(sent.properties.duration_ms).toBeGreaterThanOrEqual(120_000)
    expect(sent.properties.duration_ms).toBeLessThan(150_000)
    expect(JSON.stringify(captureServer.mock.calls)).not.toContain('plan')
  })

  it('splits the job’s queue wait from its processing time, and says screening did not run', async () => {
    makeDbMock()
    backend({
      status: 'completed',
      submitted_at: '2026-11-02T12:00:00Z',
      started_at: '2026-11-02T12:00:30Z',
      completed_at: '2026-11-02T12:02:00Z',
      file_details: [{ file_name: 'plan.pdf', status: 'success' }],
    })

    await reconcileDocumentStatuses([makeRow({ updatedAt: new Date(Date.now() - 1000) })], 'org-1', 'read')

    const [[sent]] = captureServer.mock.calls as unknown as [[{ properties: Record<string, unknown> }]]
    expect(sent.properties).toMatchObject({
      document_id: expect.any(String),
      queue_wait_ms: 30_000,
      processing_ms: 90_000,
      screening: 'not_run',
    })
  })

  it('reports a failure by its status and carries nothing of the error text', async () => {
    makeDbMock()
    backend({ status: 'failed', error_message: 'could not read secret-plan.pdf', file_details: [] })

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ status: 'failed', document_id: 'doc-1', error_reason: 'unknown' }),
      })
    )
    expect(JSON.stringify(captureServer.mock.calls)).not.toContain('secret')
  })

  it('carries the document, its attempt, who settled it and the job’s own processing time', async () => {
    makeDbMock()
    backend({
      status: 'completed',
      started_at: '2026-11-03T10:00:00.000000',
      completed_at: '2026-11-03T10:00:42.500000',
      file_details: [{ file_name: 'plan.pdf', status: 'success' }],
    })

    findIngestAnnouncementFacts.mockResolvedValueOnce(new Map([['doc-1', { attempt: 3, uploadBatchId: 'batch-1' }]]))

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'push')

    const [[sent]] = captureServer.mock.calls as unknown as [[{ properties: Record<string, unknown> }]]
    expect(sent.properties).toMatchObject({
      document_id: 'doc-1',
      attempt: 3,
      upload_id: 'batch-1',
      processing_ms: 42_500,
      settled_by: 'push',
    })
    expect(sent.properties.error_category).toBeUndefined()
  })

  it('sends the failure category the job reported, the one the row stores', async () => {
    makeDbMock()
    backend({
      status: 'failed',
      error_message: '1/1 file(s) failed',
      file_details: [
        { file_name: 'plan.pdf', status: 'failed', error_message: 'encrypted', failure_category: 'deterministic', retryable: false },
      ],
    })

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'sweep')

    const [[sent]] = captureServer.mock.calls as unknown as [[{ properties: Record<string, unknown> }]]
    expect(sent.properties).toMatchObject({ status: 'failed', error_category: 'deterministic', settled_by: 'sweep' })
    expect(sent.properties.processing_ms).toBeUndefined()
  })

  it('sends nothing for a row another read moved first', async () => {
    makeDbMock({ moved: false })
    backend({ status: 'completed', file_details: [{ file_name: 'plan.pdf', status: 'success' }] })

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(captureServer).not.toHaveBeenCalled()
  })

  it('sends nothing for a job still in progress, or for rows already at rest', async () => {
    makeDbMock()
    backend({ status: 'processing', queue_position: 0 })

    await reconcileDocumentStatuses([makeRow(), makeRow({ id: 'doc-2', status: 'completed' })], 'org-1', 'read')

    expect(captureServer).not.toHaveBeenCalled()
  })
})

describe('reconcileDocumentStatuses — settling uploads', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('hands every row it brought to rest to the settle hook, with its new status', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({
        'job-1': { status: 'completed', file_details: [{ status: 'success' }] },
        'job-2': { status: 'running' },
      })
    )

    await reconcileDocumentStatuses(
      [makeRow(), makeRow({ id: 'doc-2', metadata: { ingestJobId: 'job-2' } })],
      'org-1',
      'read'
    )

    expect(onDocumentsSettled).toHaveBeenCalledWith('org-1', [{ id: 'doc-1', status: 'completed' }])
  })

  it('settles nothing when another read moved the row first, and still reports its new status', async () => {
    makeDbMock({ moved: false })
    const verdict = 'quarantined:{"reasons":[{"kind":"iban"}],"checked":"full"}'
    mockFetch.mockResolvedValue(
      batchResponse({
        'job-1': {
          status: 'completed',
          file_details: [{ status: 'failed', error_message: verdict, screening: 'quarantined' }],
        },
      })
    )

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.status).toBe('quarantined')
    expect(onDocumentsSettled).not.toHaveBeenCalled()
  })

  it('does not call it when nothing came to rest', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(batchResponse({ 'job-1': { status: 'running' } }))

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(onDocumentsSettled).not.toHaveBeenCalled()
  })
})

describe('reconcileDocumentStatuses announcing what settled', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
    mockFetch.mockResolvedValue(
      batchResponse({ 'job-1': { status: 'completed', file_details: [{ file_name: 'plan.pdf', status: 'success' }] } })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  type ShelfRow = ReconcilableDocument & { projectId: string | null; scope: string }

  it('tells the Archiv when a listing row on it settles: the listing carries its shelf', async () => {
    makeDbMock()
    const row: ShelfRow = { ...makeRow(), projectId: null, scope: 'office_shelf' }

    await reconcileDocumentStatuses([row], 'org-1', 'read')

    expect(publishShelfChanged).toHaveBeenCalledTimes(1)
    expect(publishShelfChanged).toHaveBeenCalledWith('org-1', { kind: 'office_shelf' })
  })

  it('tells each shelf once, however many of its rows settled', async () => {
    makeDbMock()
    const rows: ShelfRow[] = [
      { ...makeRow(), projectId: 'p1', scope: 'project' },
      { ...makeRow({ id: 'doc-2' }), projectId: 'p1', scope: 'project' },
    ]

    await reconcileDocumentStatuses(rows, 'org-1', 'read')

    expect(publishShelfChanged).toHaveBeenCalledTimes(1)
    expect(publishShelfChanged).toHaveBeenCalledWith('org-1', { kind: 'project', projectId: 'p1' })
  })

  it('says nothing for a row another read moved first: that read announced it', async () => {
    makeDbMock({ moved: false })
    await reconcileDocumentStatuses([{ ...makeRow(), projectId: 'p1', scope: 'project' } as ShelfRow], 'org-1', 'read')
    expect(publishShelfChanged).not.toHaveBeenCalled()
  })

  it('says nothing for a chat attachment, which is on no shelf', async () => {
    makeDbMock()
    await reconcileDocumentStatuses([{ ...makeRow(), projectId: null, scope: 'session' } as ShelfRow], 'org-1', 'read')
    expect(publishShelfChanged).not.toHaveBeenCalled()
  })
})

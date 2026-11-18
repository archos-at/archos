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

import { makeDbMock, makeRow, mockFetch, batchResponse, collectionResponse } from './reconcile-status.fixtures'
import { reconcileDocumentStatuses, clearCollectionFilesCache, type ReconcilableDocument } from './reconcile-status'

describe('reconcileDocumentStatuses — upload screening', () => {
  const verdict =
    'quarantined:{"reasons":[{"kind":"term","term":"Lohnzettel","count":1,"pages":[1]}],"checked":"full"}'

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('quarantines a row whose only file the content gate stopped', async () => {
    const db = makeDbMock()
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
    expect(result.errorMessage).toBe(verdict)
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'quarantined',
        errorMessage: verdict,
        screeningOutcome: 'quarantined',
        quarantine: { reasons: [{ kind: 'term', term: 'Lohnzettel', count: 1, pages: [1] }], checked: 'full' },
      })
    )
    expect(db.set).toHaveBeenNthCalledWith(2, { screenedHash: null })
    expect(db.values).toHaveBeenCalledWith({
      organizationId: 'org-1',
      documentId: 'doc-1',
      jobId: 'job-1',
      scope: 'project',
      projectId: 'p1',
      filename: 'a.pdf',
      reasons: 'term:Lohnzettel',
      reasonsOmitted: 0,
      checked: 'full',
      uploadedBy: 'user-1',
    })
  })

  const typed = {
    reasons: [
      { kind: 'iban', count: 2, pages: [3, 4], sample: 'AT61 •••• •••• •••• 3201' },
      { kind: 'passport', count: 1, pages: [5] },
    ],
    checked: 'partial',
    omitted: 4,
  }

  it('quarantines from the typed verdict alone, and stores it with every kind as the job wrote it', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({
        'job-1': {
          status: 'failed',
          error_message: '1/1 file(s) failed',
          file_details: [{ status: 'failed', error_message: null, screening: 'quarantined', quarantine: typed }],
        },
      })
    )

    const [result] = await reconcileDocumentStatuses([makeRow({ quarantine: null } as Partial<ReconcilableDocument>)], 'org-1', 'read')

    expect(result.status).toBe('quarantined')
    expect((result as { quarantine?: unknown }).quarantine).toEqual(typed)
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'quarantined', quarantine: typed }))
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ reasons: 'iban,passport', reasonsOmitted: 4, checked: 'partial' })
    )
    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.objectContaining({ status: 'quarantined', hold_kinds: 'iban,other' }) })
    )
    expect(JSON.stringify(captureServer.mock.calls)).not.toContain('AT61')
  })

  it('takes the typed verdict over the message beside it', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({
        'job-1': {
          status: 'completed',
          file_details: [{ status: 'failed', error_message: verdict, screening: 'quarantined', quarantine: typed }],
        },
      })
    )

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ quarantine: typed }))
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ reasons: 'iban,passport' }))
  })

  it('quarantines from the collection file list by its typed verdict', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([{ file_name: 'plan.pdf', status: 'failed', error_message: null, quarantine: typed }])
    )

    const [result] = await reconcileDocumentStatuses([makeRow({ metadata: null })], 'org-1', 'read')

    expect(result.status).toBe('quarantined')
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ quarantine: typed }))
  })

  it('writes no verdict for an ordinary failure', async () => {
    const failed = makeDbMock()
    mockFetch.mockResolvedValue(batchResponse({ 'job-1': { status: 'failed', error_message: 'unparseable PDF' } }))
    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')
    expect(failed.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', quarantine: null }))
  })

  it('quarantines from a failed job too', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({
        'job-1': {
          status: 'failed',
          error_message: '1/1 file(s) failed',
          file_details: [{ status: 'failed', error_message: verdict, screening: 'quarantined' }],
        },
      })
    )

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.status).toBe('quarantined')
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'quarantined' }))
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1' }))
    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.objectContaining({ hold_kinds: 'term' }) })
    )
    expect(JSON.stringify(captureServer.mock.calls)).not.toContain('Lohnzettel')
  })

  it('records no decision for a row it did not move, nor for one that came to rest otherwise', async () => {
    const lost = makeDbMock({ moved: false })
    mockFetch.mockResolvedValue(batchResponse({ 'job-1': { status: 'failed', error_message: verdict } }))
    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')
    expect(lost.insert).not.toHaveBeenCalled()

    const completed = makeDbMock()
    mockFetch.mockResolvedValue(batchResponse({ 'job-1': { status: 'completed' } }))
    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')
    expect(completed.update).toHaveBeenCalled()
    expect(completed.insert).not.toHaveBeenCalled()
  })

  it('quarantines a row that carries no job from the collection file list, a decision of no dispatch', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([{ file_name: 'plan.pdf', status: 'failed', error_message: verdict }])
    )

    const [result] = await reconcileDocumentStatuses([makeRow({ metadata: null })], 'org-1', 'read')

    expect(result.status).toBe('quarantined')
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'quarantined' }))
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ jobId: null }))
  })

  it('takes no failure from the file list for a row whose job the backend forgot', async () => {
    const db = makeDbMock()
    mockFetch
      .mockResolvedValueOnce(batchResponse({}))
      .mockResolvedValue(collectionResponse([{ file_name: 'plan.pdf', status: 'failed', error_message: verdict }]))

    const [result] = await reconcileDocumentStatuses([makeRow({ metadata: { ingestJobId: 'job-2' } })], 'org-1', 'read')

    expect(result.status).toBe('pending')
    expect(db.update).not.toHaveBeenCalled()
    expect(db.insert).not.toHaveBeenCalled()
  })

  it.each(['clean', 'partial', 'unchecked'])('records the outcome %s of a completed, screened job', async (screening) => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({ 'job-1': { status: 'completed', file_details: [{ status: 'success', screening }] } })
    )

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', screeningOutcome: screening }))
  })

  it('leaves the outcome alone for a job that carried no rules (released, or screening off)', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({ 'job-1': { status: 'completed', file_details: [{ status: 'success', screening: null }] } })
    )

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    const written = db.set.mock.calls[0]?.[0] as Record<string, unknown>
    expect(written.status).toBe('completed')
    expect('screeningOutcome' in written).toBe(false)
  })

  it('does not mistake an ordinary failure for a quarantine', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(batchResponse({ 'job-1': { status: 'failed', error_message: 'unparseable PDF' } }))

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.status).toBe('failed')
    const written = db.set.mock.calls[0]?.[0] as Record<string, unknown>
    expect('screeningOutcome' in written).toBe(false)
  })
})

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
import { reconcileDocumentStatuses, clearCollectionFilesCache } from './reconcile-status'

describe('reconcileDocumentStatuses', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('preserves terminal statuses and never issues a status batch call for them', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(collectionResponse([{ file_name: 'plan.pdf', status: 'success' }]))
    const rows = [makeRow({ status: 'completed' }), makeRow({ id: 'doc-2', status: 'failed' })]

    const result = await reconcileDocumentStatuses(rows, 'org-1', 'read')

    expect(result.map((r) => r.status)).toEqual(['completed', 'failed'])
    expect(db.update).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/v1/documents/status/batch'),
      expect.anything()
    )
  })

  it('marks a row completed when the ingestion job completed', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({
        'job-1': { status: 'completed', file_details: [{ file_name: 'plan.pdf', status: 'success' }] },
      })
    )

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/documents/status/batch'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(result.status).toBe('completed')
    expect(result.errorMessage).toBeNull()
    expect(db.update).toHaveBeenCalledTimes(2)
    expect(db.set).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'completed', errorMessage: null }))
    expect(db.set).toHaveBeenNthCalledWith(2, { screenedHash: 'sha256:judged' })
  })

  it('settles a bulk upload larger than the backend takes in one status call', async () => {
    makeDbMock()
    const calls: number[] = []
    mockFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (!url.includes('/v1/documents/status/batch')) return collectionResponse([])
      const ids = (JSON.parse(init?.body ?? '{}') as { job_ids: string[] }).job_ids
      calls.push(ids.length)
      if (ids.length > 200) return { ok: false, status: 422, json: () => Promise.resolve({}) }
      return batchResponse(
        Object.fromEntries(ids.map((id) => [id, { status: 'completed', file_details: [{ file_name: 'plan.pdf', status: 'success' }] }]))
      )
    })
    const rows = Array.from({ length: 309 }, (_, i) =>
      makeRow({ id: `doc-${i}`, metadata: { ingestJobId: `job-${i}` } })
    )

    const result = await reconcileDocumentStatuses(rows, 'org-1', 'read')

    expect(Math.max(...calls)).toBeLessThanOrEqual(200)
    expect(result.filter((r) => r.status === 'completed')).toHaveLength(309)
  })

  it('settles a row whose job the backend forgot, and which was never indexed, once it is two days old', async () => {
    const db = makeDbMock()
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('/v1/documents/status/batch') ? batchResponse({ 'job-1': null, 'job-2': null }) : collectionResponse([])
    )
    const old = new Date(Date.now() - 3 * 24 * 60 * 60_000)
    const recent = new Date(Date.now() - 60 * 60_000)

    const [lost, waiting] = await reconcileDocumentStatuses(
      [
        makeRow({ updatedAt: old }),
        makeRow({ id: 'doc-2', metadata: { ingestJobId: 'job-2' }, updatedAt: recent }),
      ],
      'org-1',
      'read'
    )

    expect(lost.status).toBe('failed')
    expect(lost.errorMessage).toMatch(/^interrupted:/)
    expect(waiting.status).toBe('pending')
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', ingestFailureCategory: 'transient', ingestRetryable: true })
    )
  })

  it('does not give up an old row while the backend cannot list its collection', async () => {
    makeDbMock()
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('/v1/documents/status/batch')
        ? batchResponse({ 'job-1': null })
        : { ok: false, status: 503, json: () => Promise.resolve({}) }
    )
    const [row] = await reconcileDocumentStatuses([makeRow({ updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) })], 'org-1', 'read')
    expect(row.status).toBe('pending')
  })

  it('marks a row failed with the job error message', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({
        'job-1': { status: 'failed', error_message: 'embedding service unavailable', file_details: [] },
      })
    )

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.status).toBe('failed')
    expect(result.errorMessage).toBe('embedding service unavailable')
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorMessage: 'embedding service unavailable' })
    )
  })

  it('marks a row failed when the completed job has a single failed file', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({
        'job-1': {
          status: 'completed',
          file_details: [{ file_name: 'plan.pdf', status: 'failed', error_message: 'unparseable PDF' }],
        },
      })
    )

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.status).toBe('failed')
    expect(result.errorMessage).toBe('unparseable PDF')
  })

  it('marks a failed re-upload failed although the previous version still lists as indexed', async () => {
    const db = makeDbMock()
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('/v1/documents/status/batch')
        ? batchResponse({
            'job-1': {
              status: 'failed',
              error_message: '1/1 file(s) failed',
              file_details: [{ status: 'failed', error_message: 'PDF is encrypted' }],
            },
          })
        : collectionResponse([{ file_name: 'plan.pdf', status: 'success', chunk_count: 12 }])
    )

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.status).toBe('failed')
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorMessage: 'PDF is encrypted' })
    )
  })

  it('keeps the job message when the run died before any file reported', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({
        'job-1': {
          status: 'failed',
          error_message: 'interrupted: worker stopped',
          file_details: [{ status: 'ingesting' }],
        },
      })
    )

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorMessage: 'interrupted: worker stopped' })
    )
  })

  it('leaves a row pending while the job is still in progress', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(batchResponse({ 'job-1': { status: 'processing', file_details: [] } }))

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.status).toBe('pending')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('carries how many of the office\'s uploads wait ahead of a queued job', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({ 'job-1': { status: 'pending', file_details: [], metadata: { queue_ahead: 3 } } })
    )

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.queueAhead).toBe(3)
  })

  it('says null once the job is no longer waiting, so a count shown before clears', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      batchResponse({ 'job-1': { status: 'processing', file_details: [], metadata: { queue_ahead: null } } })
    )

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.queueAhead).toBeNull()
  })

  it('falls back to the collection file list when the job is unknown', async () => {
    const db = makeDbMock()
    mockFetch
      .mockResolvedValueOnce(batchResponse({ 'job-1': null }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            { file_id: 'f-1', file_name: 'plan.pdf', collection_name: 'proj_abc', status: 'success' },
          ]),
      })

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/v1/collections/proj_abc/documents'),
      expect.any(Object)
    )
    expect(result.status).toBe('completed')
    expect(db.update).toHaveBeenCalledTimes(2)
  })

  it('uses the collection file list for legacy rows without a job id', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          { file_id: 'f-1', file_name: 'plan.pdf', collection_name: 'proj_abc', status: 'success' },
        ]),
    })

    const [result] = await reconcileDocumentStatuses([makeRow({ metadata: null })], 'org-1', 'read')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/collections/proj_abc/documents'),
      expect.any(Object)
    )
    expect(result.status).toBe('completed')
  })

  it('fetches each collection file list only once per call', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          { file_id: 'f-1', file_name: 'plan.pdf', collection_name: 'proj_abc', status: 'success' },
          { file_id: 'f-2', file_name: 'specs.pdf', collection_name: 'proj_abc', status: 'success' },
        ]),
    })

    const rows = [
      makeRow({ metadata: null }),
      makeRow({ id: 'doc-2', filename: 'specs.pdf', metadata: null }),
    ]
    const result = await reconcileDocumentStatuses(rows, 'org-1', 'read')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.map((r) => r.status)).toEqual(['completed', 'completed'])
  })

  it('leaves rows untouched when the backend is unreachable', async () => {
    const db = makeDbMock()
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.status).toBe('pending')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('leaves rows untouched when the backend fetch times out (same fail-open as unreachable)', async () => {
    const db = makeDbMock()
    mockFetch.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.status).toBe('pending')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('bounds the status batch call with an AbortSignal', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(batchResponse({ 'job-1': { status: 'in_progress' } }))

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    const batchCall = mockFetch.mock.calls.find(([url]) => String(url).includes('/v1/documents/status/batch'))
    expect(batchCall).toBeDefined()
    expect((batchCall?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })

  it('leaves a legacy row pending when its file is not in the collection yet', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    })

    const [result] = await reconcileDocumentStatuses([makeRow({ metadata: null })], 'org-1', 'read')

    expect(result.status).toBe('pending')
    expect(db.update).not.toHaveBeenCalled()
  })
})

describe('reconcileDocumentStatuses authorship gate on the status pass', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('never resolves a machine-authored row from a colliding entry in the file list', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([
        { file_id: 'f-1', file_name: 'brandschutz-gutachten-2026-08-20.pdf', status: 'success' },
      ])
    )

    const [result] = await reconcileDocumentStatuses(
      [
        makeRow({
          status: 'pending',
          filename: 'brandschutz-gutachten-2026-08-20.pdf',
          authoredBy: 'agent',
          metadata: null,
        }),
      ],
      'org-1',
      'read'
    )

    expect(result.status).toBe('pending')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('still resolves a human row with the same filename from the same list', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([
        { file_id: 'f-1', file_name: 'brandschutz-gutachten-2026-08-20.pdf', status: 'success' },
      ])
    )

    const [result] = await reconcileDocumentStatuses(
      [
        makeRow({
          status: 'pending',
          filename: 'brandschutz-gutachten-2026-08-20.pdf',
          authoredBy: 'user',
          metadata: null,
        }),
      ],
      'org-1',
      'read'
    )

    expect(result.status).toBe('completed')
    expect(db.update).toHaveBeenCalled()
  })
})

describe('reconcileDocumentStatuses on a row the BFF is still working on', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('leaves a processing row without a job id processing, and asks the backend nothing about its status', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(collectionResponse([]))

    const [result] = await reconcileDocumentStatuses(
      [makeRow({ status: 'processing', filename: 'Bericht.docx', metadata: null })],
      'org-1',
      'read'
    )

    expect(result.status).toBe('processing')
    expect(db.update).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/v1/documents/status/batch'),
      expect.anything()
    )
  })

  it('does not adopt the previous version\'s success from the list while a re-ingest converts', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([{ file_id: 'f-1', file_name: 'Bericht.docx', status: 'success', chunk_count: 8 }])
    )

    const [result] = await reconcileDocumentStatuses(
      [makeRow({ status: 'processing', filename: 'Bericht.docx', metadata: null })],
      'org-1',
      'read'
    )

    expect(result.status).toBe('processing')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('ignores the job id a retried row still carries from its failed dispatch', async () => {
    const db = makeDbMock()
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('/v1/documents/status/batch')
        ? batchResponse({ 'job-1': { status: 'failed', error_message: 'old failure' } })
        : collectionResponse([])
    )

    const [result] = await reconcileDocumentStatuses([makeRow({ status: 'processing' })], 'org-1', 'read')

    expect(result.status).toBe('processing')
    expect(db.update).not.toHaveBeenCalled()
  })
})

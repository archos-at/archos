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
import { makeDbMock, makeRow, mockFetch, batchResponse, collectionResponse } from './reconcile-status.fixtures'
import { reconcileDocumentStatuses, clearCollectionFilesCache, type ReconcilableDocument } from './reconcile-status'

describe('reconcileDocumentStatuses on a failure the backend settled as interrupted', () => {
  const INTERRUPTED = 'interrupted: ingestion stopped when the service restarted; retry to index this file'
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)
  const interruptedRow = (overrides: Partial<ReconcilableDocument> = {}) =>
    makeRow({ status: 'failed', errorMessage: INTERRUPTED, updatedAt: minutesAgo(5), ...overrides })

  const batchCalls = () =>
    mockFetch.mock.calls.filter(([url]) => String(url).includes('/v1/documents/status/batch'))

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('heals to completed when the owner outlived the settle and finished the job', async () => {
    const db = makeDbMock()
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/v1/documents/status/batch')
          ? batchResponse({ 'job-1': { status: 'completed', file_details: [{ status: 'success' }] } })
          : collectionResponse([])
      )
    )

    const [result] = await reconcileDocumentStatuses([interruptedRow()], 'org-1', 'read')

    expect(result.status).toBe('completed')
    expect(result.errorMessage).toBeNull()
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', errorMessage: null }))
  })

  it('goes back to pending while the owner is still working, so the in-flight pass takes over', async () => {
    const db = makeDbMock()
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/v1/documents/status/batch')
          ? batchResponse({ 'job-1': { status: 'processing' } })
          : collectionResponse([])
      )
    )

    const [result] = await reconcileDocumentStatuses([interruptedRow()], 'org-1', 'read')

    expect(result.status).toBe('pending')
    expect(result.errorMessage).toBeNull()
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', errorMessage: null }))
  })

  it('stays failed, with no write, when the backend still says failed', async () => {
    const db = makeDbMock()
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/v1/documents/status/batch')
          ? batchResponse({ 'job-1': { status: 'failed', error_message: INTERRUPTED } })
          : collectionResponse([])
      )
    )

    const [result] = await reconcileDocumentStatuses([interruptedRow()], 'org-1', 'read')

    expect(batchCalls()).toHaveLength(1)
    expect(result.status).toBe('failed')
    expect(result.errorMessage).toBe(INTERRUPTED)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('does not adopt a previous version\'s success from the file list when the job is unknown', async () => {
    const db = makeDbMock()
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/v1/documents/status/batch')
          ? batchResponse({})
          : collectionResponse([{ file_name: 'plan.pdf', status: 'success' }])
      )
    )

    const [result] = await reconcileDocumentStatuses([interruptedRow()], 'org-1', 'read')

    expect(result.status).toBe('failed')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('stops asking once the row is older than the re-check window', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(collectionResponse([]))

    const rows = [interruptedRow({ updatedAt: minutesAgo(31) }), interruptedRow({ id: 'doc-2', updatedAt: null })]
    const result = await reconcileDocumentStatuses(rows, 'org-1', 'read')

    expect(batchCalls()).toHaveLength(0)
    expect(result.map((r) => r.status)).toEqual(['failed', 'failed'])
    expect(db.update).not.toHaveBeenCalled()
  })

  it('leaves other failed rows alone: another reason, or no job to ask about', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(collectionResponse([{ file_name: 'plan.pdf', status: 'success' }]))

    const rows = [
      interruptedRow({ errorMessage: 'embedding service unavailable' }),
      interruptedRow({ id: 'doc-2', errorMessage: null }),
      interruptedRow({ id: 'doc-3', metadata: {} }),
    ]
    const result = await reconcileDocumentStatuses(rows, 'org-1', 'read')

    expect(batchCalls()).toHaveLength(0)
    expect(result.map((r) => r.status)).toEqual(['failed', 'failed', 'failed'])
    expect(db.update).not.toHaveBeenCalled()
  })
})

describe('reconcileDocumentStatuses on a failure written for a forgotten job', () => {
  const forgottenRow = (overrides: Partial<ReconcilableDocument> = {}) =>
    makeRow({ status: 'failed', errorMessage: 'Job ID not found', updatedAt: new Date('2026-10-28T19:49:42Z'), ...overrides })

  const batchCalls = () =>
    mockFetch.mock.calls.filter(([url]) => String(url).includes('/v1/documents/status/batch'))

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('heals to completed from the listing when the file is indexed, without asking about the job', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(collectionResponse([{ file_name: 'plan.pdf', status: 'success', chunk_count: 12 }]))

    const [result] = await reconcileDocumentStatuses([forgottenRow()], 'org-1', 'read')

    expect(batchCalls()).toHaveLength(0)
    expect(result.status).toBe('completed')
    expect(result.errorMessage).toBeNull()
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', errorMessage: null }))
    expect(onDocumentsSettled).toHaveBeenCalledWith('org-1', [{ id: 'doc-1', status: 'completed', correction: true }])
  })

  it('stays failed, with no write, when the file was never indexed or its newest job failed', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValue(collectionResponse([{ file_name: 'other.pdf', status: 'failed' }]))

    const rows = [forgottenRow(), forgottenRow({ id: 'doc-2', filename: 'other.pdf' })]
    const result = await reconcileDocumentStatuses(rows, 'org-1', 'read')

    expect(result.map((r) => r.status)).toEqual(['failed', 'failed'])
    expect(db.update).not.toHaveBeenCalled()
  })

  it('does not guess when two files share the name, or when the listing is unavailable', async () => {
    const db = makeDbMock()
    mockFetch.mockResolvedValueOnce(
      collectionResponse([
        { file_name: 'plan.pdf', status: 'success' },
        { file_name: 'plan.pdf', status: 'success' },
      ])
    )
    const [ambiguous] = await reconcileDocumentStatuses([forgottenRow()], 'org-1', 'read')

    clearCollectionFilesCache()
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) })
    const [unavailable] = await reconcileDocumentStatuses([forgottenRow()], 'org-1', 'read')

    expect([ambiguous.status, unavailable.status]).toEqual(['failed', 'failed'])
    expect(db.update).not.toHaveBeenCalled()
  })
})

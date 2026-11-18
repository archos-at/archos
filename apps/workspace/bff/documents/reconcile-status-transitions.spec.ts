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

import { projectReadings } from '@/lib/search/facets-projector'
import { listCollectionDocumentsForProjection } from '@/lib/search/facets-repository'
import { makeDbMock, makeRow, mockFetch, batchResponse, collectionResponse } from './reconcile-status.fixtures'
import { reconcileDocumentStatuses, clearCollectionFilesCache } from './reconcile-status'

describe('reconcileDocumentStatuses collection-file-list caching', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('does not refetch the collection file list for terminal rows within the TTL', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([{ file_id: 'f-1', file_name: 'plan.pdf', status: 'success', chunk_count: 3 }])
    )
    const rows = [makeRow({ status: 'completed' })]

    await reconcileDocumentStatuses(rows, 'org-1', 'read')
    await reconcileDocumentStatuses(rows, 'org-1', 'read')

    const collectionCalls = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('/v1/collections/proj_abc/documents')
    )
    expect(collectionCalls).toHaveLength(1)
  })

  it('always refetches the collection list for in-flight rows (status freshness cannot lag)', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([{ file_id: 'f-1', file_name: 'plan.pdf', status: 'pending' }])
    )
    const rows = [makeRow({ status: 'pending', metadata: null })]

    await reconcileDocumentStatuses(rows, 'org-1', 'read')
    await reconcileDocumentStatuses(rows, 'org-1', 'read')

    const collectionCalls = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('/v1/collections/proj_abc/documents')
    )
    expect(collectionCalls).toHaveLength(2)
  })
})

describe('reconcileDocumentStatuses enrichment on a status transition', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  const collectionCalls = () =>
    mockFetch.mock.calls.filter(([url]) => String(url).includes('/v1/collections/proj_abc/documents'))

  const routeBackend = (jobs: Record<string, unknown>, listing: { current: unknown[] }) => {
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('/v1/documents/status/batch') ? batchResponse(jobs) : collectionResponse(listing.current)
    )
  }

  const indexedPlan = {
    file_id: 'f-1',
    file_name: 'plan.pdf',
    status: 'success',
    summary: 'A ground-floor plan.',
    chunk_count: 12,
    tags: ['Grundriss'],
    metadata: { page_count: 4, content_types: ['text'] },
  }

  it('enriches the read that turns a row completed from a fresh listing, not the stale cached one', async () => {
    makeDbMock()
    const listing = { current: [] as unknown[] }
    routeBackend({ 'job-1': { status: 'completed', file_details: [{ status: 'success' }] } }, listing)

    await reconcileDocumentStatuses([makeRow({ id: 'doc-old', filename: 'old.pdf', status: 'completed' })], 'org-1', 'read')
    expect(collectionCalls()).toHaveLength(1)

    listing.current = [indexedPlan]
    const [result] = await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(result.status).toBe('completed')
    expect(result.summary).toBe('A ground-floor plan.')
    expect(result.pageCount).toBe(4)
    expect(result.chunkCount).toBe(12)
    expect(result.contentTypes).toEqual(['text'])
    expect(result.tags).toEqual(['Grundriss'])
    expect(collectionCalls()).toHaveLength(2)
  })

  it('replaces the cache entry, so the next steady-state read serves the fresh listing without a fetch', async () => {
    makeDbMock()
    const listing = { current: [] as unknown[] }
    routeBackend({ 'job-1': { status: 'completed', file_details: [{ status: 'success' }] } }, listing)
    await reconcileDocumentStatuses([makeRow({ id: 'doc-old', filename: 'old.pdf', status: 'completed' })], 'org-1', 'read')
    listing.current = [indexedPlan]
    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    const [again] = await reconcileDocumentStatuses([makeRow({ status: 'completed' })], 'org-1', 'read')

    expect(again.summary).toBe('A ground-floor plan.')
    expect(collectionCalls()).toHaveLength(2)
  })

  it('hands the reading of a row that came to rest read to the search projection, with its Fassung state', async () => {
    makeDbMock()
    routeBackend(
      { 'job-1': { status: 'completed', file_details: [{ status: 'success' }] } },
      { current: [{ ...indexedPlan, superseded_by: 'plan-c.pdf' }] }
    )

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(projectReadings).toHaveBeenCalledWith('org-1', [
      expect.objectContaining({
        documentId: 'doc-1',
        superseded: true,
        metadata: expect.objectContaining({ summary: 'A ground-floor plan.', tags: ['Grundriss'] }),
      }),
    ])
  })

  it('writes the search row of the document a settled Fassung replaces, from the same listing', async () => {
    makeDbMock()
    const older = { file_id: 'f-0', file_name: 'plan-a.pdf', status: 'success', summary: 'The earlier plan.', superseded_by: 'plan.pdf' }
    routeBackend(
      { 'job-1': { status: 'completed', file_details: [{ status: 'success' }] } },
      { current: [{ ...indexedPlan, supersedes: ['plan-a.pdf'] }, older] }
    )
    vi.mocked(listCollectionDocumentsForProjection).mockResolvedValueOnce([
      { id: 'doc-a', filename: 'plan-a.pdf', collectionName: 'proj_abc', authoredBy: 'user', publishedVersionId: null },
      { id: 'doc-agent', filename: 'plan-a.pdf', collectionName: 'proj_abc', authoredBy: 'agent', publishedVersionId: null },
    ])
    const fetchesBefore = collectionCalls().length

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')
    await vi.waitFor(() => expect(projectReadings).toHaveBeenCalledTimes(2))

    expect(listCollectionDocumentsForProjection).toHaveBeenCalledWith('org-1', 'proj_abc', ['plan-a.pdf'])
    expect(projectReadings).toHaveBeenLastCalledWith('org-1', [
      expect.objectContaining({ documentId: 'doc-a', superseded: true, metadata: expect.objectContaining({ summary: 'The earlier plan.' }) }),
    ])
    expect(collectionCalls().length - fetchesBefore).toBe(1)
  })

  it('never counts the agent\'s suggestion as a replaced Fassung', async () => {
    makeDbMock()
    routeBackend(
      { 'job-1': { status: 'completed', file_details: [{ status: 'success' }] } },
      { current: [{ ...indexedPlan, revision_suggestion: { of: 'plan-a.pdf', confidence: 0.9, reason: 'r', basis: 'title_block' } }] }
    )

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')

    expect(projectReadings).toHaveBeenCalledTimes(1)
    expect(projectReadings).toHaveBeenCalledWith('org-1', [expect.objectContaining({ documentId: 'doc-1', superseded: false })])
    expect(listCollectionDocumentsForProjection).not.toHaveBeenCalled()
  })

  it('hands nothing to the search projection for a row that failed or was already at rest', async () => {
    makeDbMock()
    routeBackend({ 'job-1': { status: 'failed', error: 'kaputt' } }, { current: [indexedPlan] })

    await reconcileDocumentStatuses([makeRow()], 'org-1', 'read')
    await reconcileDocumentStatuses([makeRow({ id: 'doc-2', status: 'completed' })], 'org-1', 'read')

    expect(projectReadings).not.toHaveBeenCalled()
  })

  it('fetches a collection fresh at most once per read, however many rows transition', async () => {
    makeDbMock()
    const listing = { current: [] as unknown[] }
    routeBackend(
      {
        'job-1': { status: 'completed', file_details: [{ status: 'success' }] },
        'job-2': { status: 'completed', file_details: [{ status: 'success' }] },
      },
      listing
    )
    await reconcileDocumentStatuses([makeRow({ id: 'doc-old', filename: 'old.pdf', status: 'completed' })], 'org-1', 'read')
    listing.current = [indexedPlan, { file_id: 'f-2', file_name: 'specs.pdf', status: 'success', chunk_count: 3 }]

    const result = await reconcileDocumentStatuses(
      [
        makeRow(),
        makeRow({ id: 'doc-2', filename: 'specs.pdf', metadata: { ingestJobId: 'job-2' } }),
        makeRow({ id: 'doc-3', filename: 'legacy.pdf', metadata: null }),
        makeRow({ id: 'doc-4', filename: 'old.pdf', status: 'completed' }),
      ],
      'org-1',
      'read'
    )

    expect(result.map((r) => r.chunkCount)).toEqual([12, 3, undefined, undefined])
    expect(collectionCalls()).toHaveLength(2)
  })

  it('keeps steady-state reads of unchanged terminal rows on the cache', async () => {
    makeDbMock()
    const listing = { current: [indexedPlan] as unknown[] }
    routeBackend({}, listing)
    const row = makeRow({ status: 'completed', updatedAt: new Date(Date.now() - 60_000) })

    await reconcileDocumentStatuses([row], 'org-1', 'read')
    await reconcileDocumentStatuses([row], 'org-1', 'read')
    await reconcileDocumentStatuses([row], 'org-1', 'read')

    expect(collectionCalls()).toHaveLength(1)
  })

  it('refreshes once for a row written after the cached listing, e.g. a transition another read made', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T10:00:00Z'))
    makeDbMock()
    const listing = { current: [] as unknown[] }
    routeBackend({}, listing)
    await reconcileDocumentStatuses([makeRow({ id: 'doc-old', filename: 'old.pdf', status: 'completed' })], 'org-1', 'read')

    vi.setSystemTime(new Date('2026-09-29T10:00:05Z'))
    listing.current = [indexedPlan]
    const row = makeRow({ status: 'completed', updatedAt: new Date('2026-09-29T10:00:03Z') })
    const [first] = await reconcileDocumentStatuses([row], 'org-1', 'read')
    const [second] = await reconcileDocumentStatuses([row], 'org-1', 'read')

    expect(first.summary).toBe('A ground-floor plan.')
    expect(second.summary).toBe('A ground-floor plan.')
    expect(collectionCalls()).toHaveLength(2)
  })
})

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

import { IN_FLIGHT_DOCUMENT_STATUSES, KNOWN_DOCUMENT_STATUSES } from './document-status'
import {
  clearCollectionFilesCache,
  reconcileDocumentStatuses,
  type ReconcilableDocument,
} from './reconcile-status'

const mockFetch = vi.fn()

const makeRow = (status: string): ReconcilableDocument => ({
  id: 'doc-1',
  status,
  filename: 'plan.pdf',
  collectionName: 'proj_abc',
  authoredBy: 'user',
  publishedVersionId: null,
  errorMessage: null,
  metadata: { ingestJobId: 'job-1' },
})

const askedTheBackend = (): boolean =>
  mockFetch.mock.calls.some(([url]) => String(url).includes('/v1/documents/status/batch'))

describe('reconcileDocumentStatuses asks the backend about a row only while its status is in flight', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ statuses: { 'job-1': { status: 'processing', file_details: [] } } }),
    })
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it.each(KNOWN_DOCUMENT_STATUSES)(
    'a %s row is asked of the backend exactly when the declaration calls it in flight, except processing, which the BFF owns',
    async (status) => {
      await reconcileDocumentStatuses([makeRow(status)], 'org-1', 'read')

      expect(askedTheBackend()).toBe(IN_FLIGHT_DOCUMENT_STATUSES.has(status) && status !== 'processing')
    },
  )
})

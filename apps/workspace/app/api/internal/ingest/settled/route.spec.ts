/**
 * @vitest-environment node
 *
 * The settle push end to end below the database: the route, the service and
 * the real reconcile, with the guarded write, the backend's batch status and
 * PostHog stood in for. What the push must not change is the reconcile's own
 * promise, so the double-settle cases run through it rather than around it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The route factory statically imports the session guard, which pulls in authkit; internal routes never call it.
vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: vi.fn() }))
vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@/lib/db/tenant-context', async (original) => ({
  ...(await original<typeof import('@/lib/db/tenant-context')>()),
  withTenant: vi.fn(async (_scope: unknown, run: () => Promise<unknown>) => run()),
  withPlatformAccess: vi.fn(async (_reason: string, run: () => Promise<unknown>) => run()),
}))
vi.mock('@/lib/documents/repository', async (original) => ({
  ...(await original<typeof import('@/lib/documents/repository')>()),
  listInFlightDocumentsForIngestJobs: vi.fn(),
  setDocumentReconciledStatus: vi.fn(),
}))
vi.mock('@/lib/upload-batches/settle', () => ({ onDocumentsSettled: vi.fn().mockResolvedValue(undefined) }))
const captureServer = vi.hoisted(() => vi.fn(() => true))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer }))
vi.mock('@/lib/documents/shelf-live', () => ({ publishShelfChanged: vi.fn() }))
vi.mock('@/lib/search/facets-projector', () => ({ projectReadings: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/search/facets-repository', () => ({ listCollectionDocumentsForProjection: vi.fn().mockResolvedValue([]) }))

import { withTenant } from '@/lib/db/tenant-context'
import { clearCollectionFilesCache } from '@/lib/documents/reconcile-status'
import { listInFlightDocumentsForIngestJobs, setDocumentReconciledStatus } from '@/lib/documents/repository'
import { onDocumentsSettled } from '@/lib/upload-batches/settle'
import { makeDocument } from '@/test-utils/db-fixtures'
import { POST } from './route'

const request = (body: unknown, token: string | null = 'test-token'): Request =>
  new Request('http://localhost/api/internal/ingest/settled', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-internal-token': token } : {}) },
    body: JSON.stringify(body),
  })

const mockFetch = vi.fn()

/** The backend: every asked job completed, and the collection lists the file. */
const backendSaysCompleted = () =>
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/v1/documents/status/batch')) {
      const { job_ids: ids } = JSON.parse(String(init?.body)) as { job_ids: string[] }
      const statuses = Object.fromEntries(
        ids.map((id) => [
          id,
          {
            status: 'completed',
            started_at: '2026-11-03T10:00:00',
            completed_at: '2026-11-03T10:00:30',
            file_details: [{ file_name: 'plan.pdf', status: 'success' }],
          },
        ])
      )
      return { ok: true, status: 200, json: async () => ({ statuses }) }
    }
    return { ok: true, status: 200, json: async () => [{ file_name: 'plan.pdf', status: 'success', chunk_count: 3 }] }
  })

const pendingDocument = (id: string, organizationId: string, jobId: string) =>
  makeDocument({
    id,
    organizationId,
    status: 'pending',
    filename: 'plan.pdf',
    collectionName: 'proj_abc',
    metadata: { ingestJobId: jobId },
    ingestAttempts: 1,
  })

/** The `documents` table for this spec: a row stays in flight until the guarded write moves it, once. */
const tableOf = (rows: ReturnType<typeof pendingDocument>[]) => {
  const status = new Map(rows.map((row) => [row.id, row.status]))
  vi.mocked(listInFlightDocumentsForIngestJobs).mockImplementation(async (jobIds) =>
    rows
      .filter((row) => jobIds.includes((row.metadata as { ingestJobId: string }).ingestJobId))
      .filter((row) => status.get(row.id) === 'pending')
      .map((row) => ({ ...row }))
  )
  vi.mocked(setDocumentReconciledStatus).mockImplementation(async (id, _org, resolution, from) => {
    if (status.get(id) !== from.status) return false
    status.set(id, resolution.status)
    return true
  })
}

const settledEvents = () =>
  (captureServer.mock.calls as unknown as [{ event: string; organizationId: string; properties: Record<string, unknown> }][])
    .map(([sent]) => sent)
    .filter((sent) => sent.event === 'document_ingest_finished')

describe('POST /api/internal/ingest/settled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCollectionFilesCache()
    vi.stubGlobal('fetch', mockFetch)
    process.env.INTERNAL_API_TOKEN = 'test-token'
    process.env.APP_ENV = 'development'
    backendSaysCompleted()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('refuses a missing or wrong token, and fails closed when none is configured', async () => {
    expect((await POST(request({ job_ids: ['job-1'] }, null))).status).toBe(403)
    expect((await POST(request({ job_ids: ['job-1'] }, 'wrong'))).status).toBe(403)
    delete process.env.INTERNAL_API_TOKEN
    expect((await POST(request({ job_ids: ['job-1'] }, 'anything'))).status).toBe(503)
    expect(listInFlightDocumentsForIngestJobs).not.toHaveBeenCalled()
  })

  it('takes 1 to 200 job ids and refuses anything else', async () => {
    tableOf([])
    for (const body of [{}, { job_ids: [] }, { job_ids: [''] }, { job_ids: 'job-1' }, { job_ids: Array(201).fill('j') }]) {
      expect((await POST(request(body))).status).toBe(400)
    }
    expect(listInFlightDocumentsForIngestJobs).not.toHaveBeenCalled()
    expect((await POST(request({ job_ids: Array.from({ length: 200 }, (_, i) => `job-${i}`) }))).status).toBe(202)
  })

  it('ignores a job id no document carries', async () => {
    tableOf([])

    const response = await POST(request({ job_ids: ['job-unknown'] }))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ settled: 0 })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(captureServer).not.toHaveBeenCalled()
  })

  it('settles the named documents in their own organizations, and announces them as pushed', async () => {
    tableOf([pendingDocument('doc-1', 'org-1', 'job-1'), pendingDocument('doc-2', 'org-2', 'job-2')])

    const response = await POST(request({ job_ids: ['job-1', 'job-2', 'job-unknown'] }))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ settled: 2 })
    expect(vi.mocked(withTenant).mock.calls.map(([scope]) => scope)).toEqual(
      expect.arrayContaining([{ organizationId: 'org-1' }, { organizationId: 'org-2' }])
    )
    const events = settledEvents()
    expect(events.map((sent) => [sent.organizationId, sent.properties.document_id])).toEqual([
      ['org-1', 'doc-1'],
      ['org-2', 'doc-2'],
    ])
    expect(events[0].properties).toMatchObject({ settled_by: 'push', status: 'completed', attempt: 1, processing_ms: 30_000 })
  })

  it('settles once when the same job is pushed twice', async () => {
    tableOf([pendingDocument('doc-1', 'org-1', 'job-1')])

    const first = await POST(request({ job_ids: ['job-1', 'job-1'] }))
    const second = await POST(request({ job_ids: ['job-1'] }))

    expect(await first.json()).toEqual({ settled: 1 })
    expect(await second.json()).toEqual({ settled: 0 })
    expect(settledEvents()).toHaveLength(1)
    expect(onDocumentsSettled).toHaveBeenCalledTimes(1)
  })

  it('announces nothing when another reconcile moved the row first', async () => {
    tableOf([pendingDocument('doc-1', 'org-1', 'job-1')])
    vi.mocked(setDocumentReconciledStatus).mockResolvedValue(false)

    const response = await POST(request({ job_ids: ['job-1'] }))

    expect(response.status).toBe(202)
    expect(settledEvents()).toHaveLength(0)
    expect(onDocumentsSettled).not.toHaveBeenCalled()
  })
})

/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeRow, mockFetch, batchResponse, collectionResponse } from './reconcile-status.fixtures'
import { clearCollectionFilesCache, describeBackendIngestState } from './reconcile-status'

describe('describeBackendIngestState', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const routeBackend = (jobs: Record<string, unknown> | null, files: unknown[] | null) => {
    mockFetch.mockImplementation((url: unknown) => {
      if (String(url).includes('/v1/documents/status/batch')) {
        if (jobs === null) return Promise.reject(new Error('backend down'))
        return Promise.resolve(batchResponse(jobs))
      }
      if (files === null) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) })
      return Promise.resolve(collectionResponse(files))
    })
  }

  it('reports in-progress while the job is running, without touching the file list', async () => {
    routeBackend({ 'job-1': { status: 'running' } }, [])

    const knowledge = await describeBackendIngestState(makeRow({ status: 'processing' }))

    expect(knowledge).toEqual({ state: 'in-progress' })
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/v1/collections/'))).toBe(false)
  })

  it('reports absent when the backend forgot the job and holds no file', async () => {
    routeBackend({}, [])

    const knowledge = await describeBackendIngestState(makeRow({ status: 'processing' }))

    expect(knowledge).toEqual({ state: 'absent' })
  })

  it('reports terminal when the work landed behind the row back', async () => {
    routeBackend({}, [{ file_name: 'plan.pdf', status: 'success' }])

    const knowledge = await describeBackendIngestState(makeRow({ status: 'processing' }))

    expect(knowledge).toEqual({
      state: 'terminal',
      resolution: {
        status: 'completed',
        errorMessage: null,
        failure: { category: null, retryable: null, readerVersion: null },
      },
    })
  })

  it("reports absent, not an earlier dispatch's failure, when the backend forgot the job", async () => {
    routeBackend({}, [{ file_name: 'plan.pdf', status: 'failed', error_message: 'quarantined:{}' }])

    expect(await describeBackendIngestState(makeRow({ status: 'processing' }))).toEqual({ state: 'absent' })
    expect(await describeBackendIngestState(makeRow({ status: 'processing', metadata: null }))).toEqual({
      state: 'terminal',
      resolution: expect.objectContaining({ status: 'quarantined' }),
    })
  })

  it('reports in-progress when a file under this name is mid-flight', async () => {
    routeBackend({}, [{ file_name: 'plan.pdf', status: 'pending' }])

    const knowledge = await describeBackendIngestState(makeRow({ status: 'processing', metadata: null }))

    expect(knowledge).toEqual({ state: 'in-progress' })
  })

  it('reports unreachable when the backend cannot be asked, and refuses to guess', async () => {
    routeBackend(null, [])

    const knowledge = await describeBackendIngestState(makeRow({ status: 'processing' }))

    expect(knowledge).toEqual({ state: 'unreachable' })
  })

  it('reports unreachable when the collection list is gone', async () => {
    routeBackend({}, null)

    const knowledge = await describeBackendIngestState(makeRow({ status: 'processing', metadata: null }))

    expect(knowledge).toEqual({ state: 'unreachable' })
  })
})

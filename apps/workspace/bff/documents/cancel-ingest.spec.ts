/**
 * @vitest-environment node
 */
/**
 * `cancelDocumentIngest`: what the stop did, and the status the document holds
 * afterwards. The queue's word and the row's are two facts, because the write
 * that settles the row `cancelled` is a compare-and-set a concurrent report can
 * win, and the caller is told both.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDocument } from '@/test-utils/db-fixtures'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
vi.mock('./access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('./repository', () => ({ setDocumentReconciledStatus: vi.fn() }))
vi.mock('./reconcile-status', () => ({
  cancelledResolution: () => ({ status: 'cancelled', errorMessage: null }),
  describeBackendIngestState: vi.fn(),
  extractIngestJobId: (metadata: { ingestJobId?: string } | null) => metadata?.ingestJobId ?? null,
}))
vi.mock('./document-dispatch', () => ({ dispatchDocument: vi.fn() }))
vi.mock('./folder-path', () => ({ resolveDocumentFolderPath: vi.fn() }))
vi.mock('@/lib/upload-batches/settle', () => ({ onDocumentsSettled: vi.fn() }))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))

import { onDocumentsSettled } from '@/lib/upload-batches/settle'
import { getAccessibleDocument } from './access'
import { cancelIngestResultSchema } from './cancel-wire'
import { cancelDocumentIngest } from './reingest'
import { setDocumentReconciledStatus } from './repository'

const session = { userId: 'user_1', organizationId: 'org_1' } as AuthorizedSession
const reading = makeDocument({ id: 'doc_1', status: 'pending', metadata: { ingestJobId: 'job_1' } })

const queueAnswers = (result: string) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result }), { status: 200 })))

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(getAccessibleDocument).mockResolvedValue(reading)
})

describe('cancelDocumentIngest', () => {
  it('says cancelled twice when its own write settled the row', async () => {
    queueAnswers('cancelled')
    vi.mocked(setDocumentReconciledStatus).mockResolvedValue(true)

    await expect(cancelDocumentIngest(session, 'doc_1')).resolves.toEqual({
      id: 'doc_1',
      result: 'cancelled',
      status: 'cancelled',
    })
    expect(setDocumentReconciledStatus).toHaveBeenCalledWith(
      'doc_1',
      'org_1',
      expect.objectContaining({ status: 'cancelled' }),
      { status: 'pending', jobId: 'job_1' },
    )
    expect(onDocumentsSettled).toHaveBeenCalledWith('org_1', [{ id: 'doc_1', status: 'cancelled' }])
    // Its own write is the answer: the row is not read a second time.
    expect(getAccessibleDocument).toHaveBeenCalledTimes(1)
  })

  // The read ended as the stop went out and a report settled the row first:
  // the queue stopped a job, and the document says completed.
  it('answers the status the document holds when a report settled the row first', async () => {
    queueAnswers('cancelled')
    vi.mocked(setDocumentReconciledStatus).mockResolvedValue(false)
    vi.mocked(getAccessibleDocument)
      .mockResolvedValueOnce(reading)
      .mockResolvedValueOnce(makeDocument({ id: 'doc_1', status: 'completed' }))

    await expect(cancelDocumentIngest(session, 'doc_1')).resolves.toEqual({
      id: 'doc_1',
      result: 'cancelled',
      status: 'completed',
    })
    expect(onDocumentsSettled).not.toHaveBeenCalled()
  })

  it('answers what it saw when the row is gone by the time it looks again', async () => {
    queueAnswers('cancelled')
    vi.mocked(setDocumentReconciledStatus).mockResolvedValue(false)
    vi.mocked(getAccessibleDocument).mockResolvedValueOnce(reading).mockRejectedValueOnce(new Error('not found'))

    await expect(cancelDocumentIngest(session, 'doc_1')).resolves.toMatchObject({ result: 'cancelled', status: 'pending' })
  })

  it('answers the status of a row that had already come to rest, and asks the queue nothing', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.mocked(getAccessibleDocument).mockResolvedValue(makeDocument({ id: 'doc_1', status: 'failed' }))

    await expect(cancelDocumentIngest(session, 'doc_1')).resolves.toEqual({
      id: 'doc_1',
      result: 'finished',
      status: 'failed',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each(['finished', 'unavailable'] as const)('leaves the row as it is when the queue says %s', async (result) => {
    queueAnswers(result)

    await expect(cancelDocumentIngest(session, 'doc_1')).resolves.toEqual({ id: 'doc_1', result, status: 'pending' })
    expect(setDocumentReconciledStatus).not.toHaveBeenCalled()
  })

  it('answers unavailable for work that carries no job id', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(makeDocument({ id: 'doc_1', status: 'processing', metadata: {} }))

    await expect(cancelDocumentIngest(session, 'doc_1')).resolves.toEqual({
      id: 'doc_1',
      result: 'unavailable',
      status: 'processing',
    })
  })
})

describe('the wire schema of the answer', () => {
  it('reads an answer from before the status field', () => {
    expect(cancelIngestResultSchema.parse({ id: 'doc_1', result: 'cancelled' })).toEqual({
      id: 'doc_1',
      result: 'cancelled',
    })
  })

  it('refuses an outcome it does not know', () => {
    expect(cancelIngestResultSchema.safeParse({ id: 'doc_1', result: 'stopped' }).success).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/jobs-queue/enqueue', () => ({ enqueueJob: vi.fn().mockResolvedValue({ jobId: 'bff-job-1' }) }))

vi.mock('@/lib/jobs-queue/repository', () => ({ findOpenJobId: vi.fn().mockResolvedValue(null) }))

vi.mock('./repository', () => ({
  markDocumentProcessing: vi.fn().mockResolvedValue(undefined),
  setDocumentBackgroundJob: vi.fn().mockResolvedValue(undefined),
  markDocumentIngestFailed: vi.fn().mockResolvedValue(undefined),
  setDocumentIngestJob: vi.fn().mockResolvedValue(undefined),
  markDocumentNotIndexed: vi.fn().mockResolvedValue(undefined),
  findDocumentInOrg: vi.fn(),
  findFolderPathInProject: vi.fn(),
  findStorageKeyByCollectionAndFilename: vi.fn(),
  listProjectDocuments: vi.fn(),
  deleteProjectDocument: vi.fn(),
}))

vi.mock('@/lib/organizations/service', () => ({ getOrgSettings: vi.fn() }))

vi.mock('./rendition', async (importOriginal) => {
  const { renditionModuleMock } = await import('@/test-utils/rendition-module')
  return renditionModuleMock(await importOriginal(), false)
})

import { getOrgSettings } from '@/lib/organizations/service'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { isRenditionEnabled } from './rendition'
import { findDocumentInOrg, markDocumentIngestFailed } from './repository'
import { makeDocument } from '@/test-utils/db-fixtures'
import { INGEST_DISPATCH_FAILED_MESSAGE } from './ingest-dispatch'
import { redispatchStuckDocument } from './ingest-recovery'

let fetchSpy: ReturnType<typeof vi.fn>

function queuedJob() {
  const queued = vi.mocked(enqueueJob).mock.calls.at(-1)?.[0]
  if (!queued) throw new Error('nothing was queued')
  return queued
}

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ job_id: 'job-1' }) })
  vi.stubGlobal('fetch', fetchSpy)
  vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ authoredBy: 'user' }))
  vi.mocked(getOrgSettings).mockResolvedValue({ displayName: null, defaultLocale: 'de', homeCountry: null, settings: {} })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('redispatchStuckDocument', () => {
  const stuck = (overrides: Partial<ReturnType<typeof makeDocument>> = {}) =>
    makeDocument({
      authoredBy: 'user',
      status: 'processing',
      filename: 'haus.ifc',
      storageKey: 'org/org-1/project/proj-1/doc/doc-1/haus.ifc',
      ...overrides,
    })

  it('queues a stranded model again, behind the people who are waiting', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(stuck())

    await expect(redispatchStuckDocument('org-1', 'doc-1')).resolves.toBe('requeued')

    expect(queuedJob()).toMatchObject({
      kind: 'bim_extract',
      organizationId: 'org-1',
      priority: 1,
      payload: expect.objectContaining({ documentId: 'doc-1', collectionName: 'proj_abc' }),
    })
  })

  it('queues a stranded office file the same way', async () => {
    vi.mocked(isRenditionEnabled).mockReturnValue(true)
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      stuck({
        filename: 'Baubeschreibung.docx',
        contentType: null,
        storageKey: 'org/org-1/project/proj-1/doc/doc-1/Baubeschreibung.docx',
      }),
    )

    await expect(redispatchStuckDocument('org-1', 'doc-1')).resolves.toBe('requeued')

    expect(queuedJob()).toMatchObject({ kind: 'office_rendition', priority: 1 })
    vi.mocked(isRenditionEnabled).mockReturnValue(false)
  })

  it('leaves a row alone that is gone or has moved on since the sweep read it', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValueOnce(null)
    await expect(redispatchStuckDocument('org-1', 'doc-1')).resolves.toBe('gone')

    vi.mocked(findDocumentInOrg).mockResolvedValueOnce(stuck({ status: 'pending' }))
    await expect(redispatchStuckDocument('org-1', 'doc-1')).resolves.toBe('gone')

    expect(enqueueJob).not.toHaveBeenCalled()
  })

  it.each<[string, { storageKey?: string; authoredBy?: 'agent' }]>([
    ['no stored bytes to rebuild from', { storageKey: '' }],
    ['a document a machine wrote, which only its publish may index', { authoredBy: 'agent' as const }],
  ])('fails a row with %s, so no later sweep finds it again', async (_why, overrides) => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(stuck(overrides))

    await expect(redispatchStuckDocument('org-1', 'doc-1')).resolves.toBe('failed')

    expect(markDocumentIngestFailed).toHaveBeenCalledWith('doc-1', 'org-1', INGEST_DISPATCH_FAILED_MESSAGE)
    expect(enqueueJob).not.toHaveBeenCalled()
  })

  it('answers failed when the queue cannot be written, and the row says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(findDocumentInOrg).mockResolvedValue(stuck())
    vi.mocked(enqueueJob).mockRejectedValueOnce(new Error('database gone'))

    await expect(redispatchStuckDocument('org-1', 'doc-1')).resolves.toBe('failed')

    expect(markDocumentIngestFailed).toHaveBeenCalledWith('doc-1', 'org-1', INGEST_DISPATCH_FAILED_MESSAGE)
  })
})

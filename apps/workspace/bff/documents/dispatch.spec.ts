import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/s3')>()),
  s3Client: { send: vi.fn().mockResolvedValue(undefined) },
  signingS3Client: { send: vi.fn().mockResolvedValue(undefined) },
  bucketAdminS3Client: { send: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://seaweedfs.internal/presigned'),
}))

vi.mock('@/lib/backend-proxy', () => ({
  getBackendUrl: vi.fn().mockReturnValue('http://backend:8000'),
}))

vi.mock('@/lib/bim/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bim/service')>()),
  runBimExtraction: vi.fn().mockResolvedValue({ status: 'ready' }),
}))

vi.mock('@/lib/jobs-queue/enqueue', () => ({ enqueueJob: vi.fn().mockResolvedValue({ jobId: 'bff-job-1' }) }))

vi.mock('@/lib/jobs-queue/repository', () => ({ findOpenJobId: vi.fn().mockResolvedValue(null) }))

vi.mock('./shelf-live', () => ({ publishShelfChanged: vi.fn() }))

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

vi.mock('@/lib/base-knowledge/text-guard', async () => ({
  isTextHeld: vi.fn(async () => false),
  copyMarkForIngest: vi.fn(async () => null),
  licenceMarkFields: (await vi.importActual<typeof import('@/lib/base-knowledge/office/text-use')>('@/lib/base-knowledge/office/text-use')).licenceMarkFields,
}))

vi.mock('@/lib/budgets/ingest-allowance', () => ({ ingestAllowanceSpent: vi.fn(async () => false) }))

vi.mock('./rendition', async (importOriginal) => {
  const { renditionModuleMock } = await import('@/test-utils/rendition-module')
  return renditionModuleMock(await importOriginal(), false)
})

import { runBimExtraction } from '@/lib/bim/service'
import { ingestAllowanceSpent } from '@/lib/budgets/ingest-allowance'
import { getOrgSettings } from '@/lib/organizations/service'
import { isTextHeld } from '@/lib/base-knowledge/text-guard'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { findOpenJobId } from '@/lib/jobs-queue/repository'
import { bimExtractPayloadSchema, officeRenditionPayloadSchema, type JobAttempt } from '@/lib/jobs-queue/types'
import {
  findDocumentInOrg,
  markDocumentIngestFailed,
  markDocumentProcessing,
  setDocumentBackgroundJob,
  setDocumentIngestJob,
  markDocumentNotIndexed,
} from './repository'
import { publishShelfChanged } from './shelf-live'
import { makeDocument } from '@/test-utils/db-fixtures'
import { internalRead } from '@/lib/documents/document-reader'
import { dispatchDocument, type DispatchDocumentInput } from './document-dispatch'
import { runBimExtractJob, runOfficeRenditionJob } from './extraction-jobs'
import { INGEST_ALLOWANCE_SPENT_MESSAGE, INGEST_DISPATCH_FAILED_MESSAGE } from './ingest-dispatch'

const input = (filename: string): DispatchDocumentInput => ({
  organizationId: 'org-1',
  projectId: 'proj-1',
  documentId: 'doc-1',
  filename,
  storageKey: `org/org-1/project/proj-1/doc/doc-1/${filename}`,
  storageBucket: 'test-bucket',
  collectionName: 'proj_abc',
})

let fetchSpy: ReturnType<typeof vi.fn>

function queuedJob() {
  const queued = vi.mocked(enqueueJob).mock.calls.at(-1)?.[0]
  if (!queued) throw new Error('nothing was queued')
  return queued
}

async function runQueuedJob(attempt: JobAttempt = { last: false }): Promise<void> {
  const queued = queuedJob()
  const current = await findDocumentInOrg('doc-1', 'org-1', internalRead('ingest'))
  vi.mocked(findDocumentInOrg).mockResolvedValue({
    ...(current as NonNullable<typeof current>),
    storageKey: String(queued.payload.storageKey),
    status: 'processing',
  })
  if (queued.kind === 'bim_extract') {
    return runBimExtractJob(queued.organizationId, bimExtractPayloadSchema.parse(queued.payload), attempt)
  }
  return runOfficeRenditionJob(queued.organizationId, officeRenditionPayloadSchema.parse(queued.payload), attempt)
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

describe('dispatchDocument', () => {
  it('REFUSES a document a machine wrote, whatever the caller asked for', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ authoredBy: 'agent' }))

    await expect(dispatchDocument(input('bericht.docx'))).rejects.toThrow(
      /must not be indexed/,
    )

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(runBimExtraction).not.toHaveBeenCalled()
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })

  it.each(['report.pdf', 'haus.ifc'])('leaves a quarantined %s where it is, for a reviewer to decide', async (name) => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ authoredBy: 'user', status: 'quarantined' }))

    await expect(dispatchDocument(input(name))).resolves.toEqual({ jobId: null, status: 'quarantined' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(runBimExtraction).not.toHaveBeenCalled()
    expect(markDocumentProcessing).not.toHaveBeenCalled()
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })

  it.each(['report.pdf', 'haus.ifc'])('reads nothing for an archived %s, and says so on the row', async (name) => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ authoredBy: 'user', lifecycle: 'archived' }))

    await expect(dispatchDocument(input(name))).resolves.toEqual({ jobId: null, status: 'stored' })

    expect(markDocumentNotIndexed).toHaveBeenCalledWith('doc-1', 'org-1')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(runBimExtraction).not.toHaveBeenCalled()
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })

  it('reads nothing for a metadata-only office shelf copy, and asks only for office shelf rows', async () => {
    vi.mocked(isTextHeld).mockResolvedValueOnce(true)
    vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ authoredBy: 'user', scope: 'office_shelf' }))
    await expect(dispatchDocument(input('ÖNORM B 1600.pdf'))).resolves.toEqual({ jobId: null, status: 'stored' })
    expect(isTextHeld).toHaveBeenCalledWith('org-1', 'doc-1')
    expect(markDocumentNotIndexed).toHaveBeenCalledWith('doc-1', 'org-1')
    expect(fetchSpy).not.toHaveBeenCalled()

    vi.mocked(isTextHeld).mockClear()
    vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ authoredBy: 'user', scope: 'project' }))
    await dispatchDocument(input('report.pdf'))
    expect(isTextHeld).not.toHaveBeenCalled()
  })

  describe('the published-version clause', () => {
    const agentRow = (publishedVersionId: string | null) =>
      makeDocument({
        authoredBy: 'agent',
        authoredByProducer: 'agent_document',
        authoredByRef: 'conv_1-aktenvermerk',
        authoredByRefKind: 'answer_artifact',
        filename: 'piloti/doc-1/aktenvermerk-2026-09-01.md',
        publishedVersionId,
      })

    it('admits the published version of an agent-authored document', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(agentRow('ver_2'))

      await expect(
        dispatchDocument({ ...input('aktenvermerk.md'), versionId: 'ver_2' }),
      ).resolves.toEqual({ jobId: 'job-1', status: 'pending' })
    })

    const refused: Array<[string, string | null, string | null]> = [
      ['a draft, before anything was ever published', null, 'ver_1'],
      ['an in-review version', null, 'ver_1'],
      ['a changes-requested version', null, 'ver_1'],
      ['a rejected version', null, 'ver_1'],
      ['an approved version that nobody has published yet', null, 'ver_2'],
      ['a superseded version, after the pointer moved on', 'ver_3', 'ver_2'],
      ['a draft alongside a published version', 'ver_2', 'ver_3'],
      ['a caller that names no version at all (a re-index)', 'ver_2', null],
    ]

    it.each(refused)('refuses %s', async (_case, pointer, dispatched) => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(agentRow(pointer))

      await expect(
        dispatchDocument({ ...input('aktenvermerk.md'), versionId: dispatched }),
      ).rejects.toThrow(/must not be indexed/)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(setDocumentIngestJob).not.toHaveBeenCalled()
    })

    it('does not let a caller assert the pointer: the ROW decides', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(agentRow(null))

      await expect(
        dispatchDocument({ ...input('aktenvermerk.md'), versionId: 'ver_2' }),
      ).rejects.toThrow(/must not be indexed/)
    })

    it('leaves a human upload admitted with no version named at all', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ authoredBy: 'user' }))

      await expect(dispatchDocument(input('plan.pdf'))).resolves.toEqual({
        jobId: 'job-1',
        status: 'pending',
      })
    })
  })

  it('refuses even when the filename would route to IFC extraction', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ authoredBy: 'agent' }))

    await expect(dispatchDocument(input('haus.ifc'))).rejects.toThrow(/must not be indexed/)
    expect(runBimExtraction).not.toHaveBeenCalled()
    expect(enqueueJob).not.toHaveBeenCalled()
  })

  it('lets a document a person uploaded through', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ authoredBy: 'user' }))

    await expect(dispatchDocument(input('plan.pdf'))).resolves.toEqual({
      jobId: 'job-1',
      status: 'pending',
    })
  })

  it('sends an ordinary document to the ingestor', async () => {
    const result = await dispatchDocument(input('plan.pdf'))

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://backend:8000/v1/ingest',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(runBimExtraction).not.toHaveBeenCalled()
    expect(setDocumentIngestJob).toHaveBeenCalledWith('doc-1', 'org-1', 'job-1', null, expect.objectContaining({ ingestJobId: null }))
    expect(result).toEqual({ jobId: 'job-1', status: 'pending' })
  })

  it('starts no ingestion once the month\'s ingest allowance is spent, and says so on the row', async () => {
    vi.mocked(ingestAllowanceSpent).mockResolvedValueOnce(true)

    await expect(dispatchDocument(input('report.pdf'))).resolves.toEqual({ jobId: null, status: 'failed' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(markDocumentIngestFailed).toHaveBeenCalledWith('doc-1', 'org-1', INGEST_ALLOWANCE_SPENT_MESSAGE, expect.anything())
  })

  it('sends an IFC model to extraction and NEVER to the ingestor', async () => {
    const result = await dispatchDocument(input('haus.ifc'))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(markDocumentProcessing).toHaveBeenCalledWith('doc-1', 'org-1')
    expect(result).toEqual({ jobId: null, status: 'processing' })

    expect(runBimExtraction).not.toHaveBeenCalled()
    expect(queuedJob()).toMatchObject({
      kind: 'bim_extract',
      organizationId: 'org-1',
      priority: 0,
      payload: expect.objectContaining({ documentId: 'doc-1', filename: 'haus.ifc' }),
    })
    expect(setDocumentBackgroundJob).toHaveBeenCalledWith('doc-1', 'org-1', 'bff-job-1')

    await runQueuedJob()
    expect(runBimExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1', filename: 'haus.ifc' }),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('tells the project’s shelf once the model is ready, and nobody for a model outside a project or one that failed', async () => {
    await dispatchDocument(input('haus.ifc'))
    await runQueuedJob()
    expect(publishShelfChanged).toHaveBeenCalledTimes(1)
    expect(publishShelfChanged).toHaveBeenCalledWith('org-1', { kind: 'project', projectId: 'proj-1' })

    vi.mocked(publishShelfChanged).mockClear()
    await dispatchDocument({ ...input('haus.ifc'), projectId: null })
    await runQueuedJob()
    vi.mocked(runBimExtraction).mockResolvedValueOnce({ modelId: 'm-1', status: 'failed', elementCount: 0, error: 'unreadable' })
    await dispatchDocument(input('haus.ifc'))
    await runQueuedJob()
    expect(publishShelfChanged).not.toHaveBeenCalled()
  })

  it('queues a reindex’s model behind the people who are waiting', async () => {
    await dispatchDocument({ ...input('haus.ifc'), priority: 'bulk' })

    expect(queuedJob()).toMatchObject({ kind: 'bim_extract', priority: 1 })
  })

  it('does not queue a second job for the object that already has one open', async () => {
    vi.mocked(findOpenJobId).mockResolvedValueOnce('bff-job-open')

    await expect(dispatchDocument(input('haus.ifc'))).resolves.toEqual({ jobId: null, status: 'processing' })

    expect(enqueueJob).not.toHaveBeenCalled()
    expect(setDocumentBackgroundJob).toHaveBeenCalledWith('doc-1', 'org-1', 'bff-job-open')
    expect(findOpenJobId).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'bim_extract',
        matching: { documentId: 'doc-1', storageKey: input('haus.ifc').storageKey },
      }),
    )
  })

  it('fails the row, and says so, when the job cannot be queued', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(enqueueJob).mockRejectedValueOnce(new Error('database gone'))

    await expect(dispatchDocument(input('haus.ifc'))).resolves.toEqual({ jobId: null, status: 'failed' })

    expect(markDocumentIngestFailed).toHaveBeenCalledWith('doc-1', 'org-1', INGEST_DISPATCH_FAILED_MESSAGE)
  })

  it('routes the uppercase and .ifczip spellings to extraction too', async () => {
    await dispatchDocument(input('HAUS.IFC'))
    await dispatchDocument(input('haus.ifczip'))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(vi.mocked(enqueueJob).mock.calls.map(([job]) => job.kind)).toEqual(['bim_extract', 'bim_extract'])
  })

  it('ingests the digest extraction produces, not the model', async () => {
    await dispatchDocument(input('haus.ifc'))
    await runQueuedJob()

    const [{ dispatchDigest }] = vi.mocked(runBimExtraction).mock.calls[0]
    await dispatchDigest('org/org-1/project/proj-1/doc/doc-1/_bim/digest.md')

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://backend:8000/v1/ingest',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

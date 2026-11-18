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

vi.mock('./rendition', async (importOriginal) => {
  const { renditionModuleMock } = await import('@/test-utils/rendition-module')
  return renditionModuleMock(await importOriginal(), false)
})

import { runBimExtraction } from '@/lib/bim/service'
import { getOrgSettings } from '@/lib/organizations/service'
import { copyMarkForIngest } from '@/lib/base-knowledge/text-guard'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { bimExtractPayloadSchema, officeRenditionPayloadSchema, type JobAttempt } from '@/lib/jobs-queue/types'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { findDocumentInOrg, markDocumentIngestFailed, setDocumentIngestJob } from './repository'
import { makeDocument } from '@/test-utils/db-fixtures'
import { internalRead } from '@/lib/documents/document-reader'
import { DOCUMENT_TYPE_TAGS } from './tag-vocabulary'
import { dispatchDocument, type DispatchDocumentInput } from './document-dispatch'
import { runBimExtractJob, runOfficeRenditionJob } from './extraction-jobs'

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

const MAIL_THREAD = { latest_sent_at: '2026-10-14T07:12:00Z', message_count: 4, locale: 'de' as const }

const MAIL_ORIGIN = {
  sent_at: '2026-10-14T07:12:00Z',
  received_at: '2026-10-14T07:14:00Z',
  from_name: 'Mag. Anna Huber',
  from_domain: 'ma37.wien.gv.at',
  signer_domain: 'ma37.wien.gv.at',
  sender_trust: 'external_verified' as const,
  locale: 'de' as const,
}

describe('the ingest dispatch sends the document folder path', () => {
  const bodyOf = (call: number): Record<string, unknown> =>
    JSON.parse(fetchSpy.mock.calls[call][1].body as string) as Record<string, unknown>

  it('signs file_ref and the thumbnail slot for a day: the queued JOB uses them, not the request', async () => {
    await dispatchDocument(input('plan.pdf'))

    const signed = vi.mocked(getSignedUrl).mock.calls
    const originalRead = signed.find(
      ([, command]) =>
        (command as { input: { Key: string } }).input.Key === input('plan.pdf').storageKey &&
        command.constructor.name === 'GetObjectCommand',
    )
    const thumbnailWrite = signed.find(([, command]) => command.constructor.name === 'PutObjectCommand')
    expect(originalRead?.[2]).toEqual({ expiresIn: 86_400 })
    expect(thumbnailWrite?.[2]).toEqual({ expiresIn: 86_400 })
  })

  it('states the original’s size only when the row names the bytes it sends', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ authoredBy: 'user', storageKey: input('plan.pdf').storageKey, fileSize: 52_428_800 }),
    )
    await dispatchDocument(input('plan.pdf'))
    expect(bodyOf(0).byte_size).toBe(52_428_800)

    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ authoredBy: 'user', storageKey: 'org/org-1/other.ifc', fileSize: 52_428_800 }),
    )
    await dispatchDocument(input('plan.pdf'))
    expect(bodyOf(1).byte_size).toBeNull()
  })

  it('stamps a confirmed copy’s licence mark on the job, as the licensed seam reads it', async () => {
    vi.mocked(copyMarkForIngest).mockResolvedValueOnce({
      licenceClass: 'licensed',
      aiProcessingAttested: true,
      quoteMaxChars: 500,
      editionId: 'ed-1',
    })
    await dispatchDocument(input('plan.pdf'))

    expect(bodyOf(0)).toMatchObject({
      licence_class: 'licensed',
      ai_processing_attested: true,
      quote_max_chars: 500,
      knowledge_edition_id: 'ed-1',
    })
  })

  it('sends the folder path the document was filed under', async () => {
    await dispatchDocument({ ...input('plan.pdf'), folderPath: 'Brandschutz/Fluchtwege' })

    expect(bodyOf(0).folder_path).toBe('Brandschutz/Fluchtwege')
  })

  it('states the row’s own filename as the chunk join key', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({
        authoredBy: 'agent',
        authoredByProducer: 'agent_document',
        authoredByRef: 'conv_1-x',
        authoredByRefKind: 'answer_artifact',
        filename: 'piloti/doc-1/aktenvermerk-2026-09-01.md',
        publishedVersionId: 'ver_2',
      }),
    )

    await dispatchDocument({ ...input('aktenvermerk.md'), versionId: 'ver_2' })

    expect(bodyOf(0).file_name).toBe('piloti/doc-1/aktenvermerk-2026-09-01.md')
  })

  it('sends the four provenance keys for a published agent document', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({
        authoredBy: 'agent',
        authoredByProducer: 'agent_document',
        authoredByRef: 'conv_1-x',
        authoredByRefKind: 'answer_artifact',
        filename: 'piloti/doc-1/aktenvermerk-2026-09-01.md',
        publishedVersionId: 'ver_2',
      }),
    )

    await dispatchDocument({
      ...input('aktenvermerk.md'),
      versionId: 'ver_2',
      provenance: {
        authored_by: 'agent',
        approved_by: 'Maria Huber',
        approved_at: '2026-09-01T10:00:00.000Z',
        producer: 'agent_document',
      },
    })

    expect(bodyOf(0)).toMatchObject({
      authored_by: 'agent',
      approved_by: 'Maria Huber',
      approved_at: '2026-09-01T10:00:00.000Z',
      producer: 'agent_document',
    })
  })

  it('sends no provenance keys for a human document', async () => {
    await dispatchDocument(input('plan.pdf'))

    const body = bodyOf(0)
    expect(body).not.toHaveProperty('authored_by')
    expect(body).not.toHaveProperty('approved_by')
  })

  it('sends the older file’s name when the upload was filed as its new Fassung (ADR-0099)', async () => {
    await dispatchDocument({ ...input('Grundriss_EG_Index_C.pdf'), revisionOf: 'Grundriss_EG_Index_B.pdf' })

    expect(bodyOf(0).revision_of).toBe('Grundriss_EG_Index_B.pdf')
  })

  it('sends no revision_of at all for an upload nobody filed as a Fassung', async () => {
    await dispatchDocument(input('plan.pdf'))
    await dispatchDocument({ ...input('plan.pdf'), revisionOf: null })

    expect(bodyOf(0)).not.toHaveProperty('revision_of')
    expect(bodyOf(1)).not.toHaveProperty('revision_of')
  })

  it('sends the document type the filing chose, as document_type', async () => {
    await dispatchDocument({ ...input('letter.pdf'), documentType: DOCUMENT_TYPE_TAGS[7] })

    expect(bodyOf(0).document_type).toBe(DOCUMENT_TYPE_TAGS[7])
  })

  it('sends no document_type at all for a filing that chose none', async () => {
    await dispatchDocument(input('plan.pdf'))
    await dispatchDocument({ ...input('plan.pdf'), documentType: null })

    expect(bodyOf(0)).not.toHaveProperty('document_type')
    expect(bodyOf(1)).not.toHaveProperty('document_type')
  })

  it('sends a Verlauf its thread and an attachment its mail, and records each with the filing choice', async () => {
    await dispatchDocument({ ...input('Stellplatznachweis.md'), mailThread: MAIL_THREAD })
    await dispatchDocument({ ...input('Bescheid.pdf'), mailOrigin: MAIL_ORIGIN })
    await dispatchDocument(input('plan.pdf'))

    expect(bodyOf(0).mail_thread).toEqual(MAIL_THREAD)
    expect(bodyOf(0)).not.toHaveProperty('mail_origin')
    expect(bodyOf(1).mail_origin).toEqual(MAIL_ORIGIN)
    expect(bodyOf(1)).not.toHaveProperty('mail_thread')
    expect(bodyOf(2)).not.toHaveProperty('mail_thread')
    expect(bodyOf(2)).not.toHaveProperty('mail_origin')
    expect(vi.mocked(setDocumentIngestJob).mock.calls.map((call) => call[3])).toEqual([
      { mailThread: MAIL_THREAD },
      { mailOrigin: MAIL_ORIGIN },
      null,
    ])
  })

  it('never sends both mail records on one document, which the backend refuses', async () => {
    await dispatchDocument({ ...input('Stellplatznachweis.md'), mailThread: MAIL_THREAD, mailOrigin: MAIL_ORIGIN })

    expect(bodyOf(0).mail_thread).toEqual(MAIL_THREAD)
    expect(bodyOf(0)).not.toHaveProperty('mail_origin')
  })

  it('records the filing choice on the row with the job, and none for a dispatch without one', async () => {
    await dispatchDocument({
      ...input('Grundriss_EG_Index_C.pdf'),
      documentType: DOCUMENT_TYPE_TAGS[2],
      revisionOf: 'Grundriss_EG_Index_B.pdf',
      revisionOfId: '0b6c8a52-3f1e-4c7a-9d2b-5e8f1a2b3c4d',
    })
    await dispatchDocument(input('plan.pdf'))

    const recorded = vi.mocked(setDocumentIngestJob).mock.calls.map((call) => call[3])
    expect(recorded).toEqual([
      { documentType: DOCUMENT_TYPE_TAGS[2], revisionOfId: '0b6c8a52-3f1e-4c7a-9d2b-5e8f1a2b3c4d' },
      null,
    ])
    expect(bodyOf(0)).not.toHaveProperty('revision_of_id')
  })

  it('sends null for a document at the project root', async () => {
    await dispatchDocument(input('plan.pdf'))

    expect(bodyOf(0).folder_path).toBeNull()
  })

  it('carries the folder onto the digest an IFC model produces', async () => {
    await dispatchDocument({ ...input('haus.ifc'), folderPath: 'Modelle' })
    await runQueuedJob()

    const [{ dispatchDigest }] = vi.mocked(runBimExtraction).mock.calls[0]
    await dispatchDigest('org/org-1/project/proj-1/doc/doc-1/_bim/digest.md')

    expect(bodyOf(0).folder_path).toBe('Modelle')
  })
})

describe('the ingest dispatch after a timeout', () => {
  const timeout = () =>
    Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })

  it('asks once more and records the job the backend holds', async () => {
    fetchSpy
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ job_id: 'job-live' }) })

    await expect(dispatchDocument(input('plan.pdf'))).resolves.toEqual({
      jobId: 'job-live',
      status: 'pending',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1][1].body).toBe(fetchSpy.mock.calls[0][1].body)
    expect(setDocumentIngestJob).toHaveBeenCalledWith('doc-1', 'org-1', 'job-live', null, expect.objectContaining({ ingestJobId: null }))
    expect(markDocumentIngestFailed).not.toHaveBeenCalled()
  })

  it('records a failure only when the second attempt times out too', async () => {
    fetchSpy.mockRejectedValueOnce(timeout()).mockRejectedValueOnce(timeout())

    await expect(dispatchDocument(input('plan.pdf'))).resolves.toEqual({
      jobId: null,
      status: 'failed',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(markDocumentIngestFailed).toHaveBeenCalledWith(
      'doc-1',
      'org-1',
      'Ingestion could not be started',
      expect.objectContaining({ ingestJobId: null })
    )
  })

  it('does not retry a failure the backend reported', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })

    await expect(dispatchDocument(input('plan.pdf'))).resolves.toEqual({
      jobId: null,
      status: 'failed',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(markDocumentIngestFailed).toHaveBeenCalled()
  })

  it('does not retry a connection that never reached the backend', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(dispatchDocument(input('plan.pdf'))).resolves.toEqual({
      jobId: null,
      status: 'failed',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

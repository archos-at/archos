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
import { invalidateCached } from '@/lib/cache'
import { getOrgSettings } from '@/lib/organizations/service'
import { copyMarkForIngest, isTextHeld } from '@/lib/base-knowledge/text-guard'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { findOpenJobId } from '@/lib/jobs-queue/repository'
import {
  bimExtractPayloadSchema,
  officeRenditionPayloadSchema,
  type JobAttempt,
} from '@/lib/jobs-queue/types'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { RenditionFailedError, ensureRendition, isRenditionEnabled } from './rendition'
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
import { DOCUMENT_TYPE_TAGS } from './tag-vocabulary'
import { dispatchDocument, type DispatchDocumentInput } from './document-dispatch'
import { runBimExtractJob, runOfficeRenditionJob } from './extraction-jobs'
import { DRAWING_UNREADABLE_MESSAGE, INGEST_DISPATCH_FAILED_MESSAGE, RENDITION_REQUIRED_MESSAGE } from './ingest-dispatch'
import { redispatchStuckDocument } from './ingest-recovery'

const input = (filename: string): DispatchDocumentInput => ({
  organizationId: 'org-1',
  projectId: 'proj-1',
  documentId: 'doc-1',
  filename,
  storageKey: `org/org-1/project/proj-1/doc/doc-1/${filename}`,
  storageBucket: 'test-bucket',
  collectionName: 'proj_abc',
})

const ownedBy = (filename: string) => ({
  storageKey: input(filename).storageKey,
  backgroundJobId: null,
  unnamedCounts: true,
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

describe('an office file is converted, by a job, before it is ingested', () => {
  const bodyOf = (call: number): Record<string, unknown> =>
    JSON.parse(fetchSpy.mock.calls[call][1].body as string) as Record<string, unknown>
  const RENDITION_KEY = 'org/org-1/project/proj-1/doc/doc-1/_render.pdf'
  const RENDITION_URL = 'https://seaweedfs.internal/rendition'
  const ORIGINAL_URL = 'https://seaweedfs.internal/presigned'
  const officeRow = (filename: string, contentType: string | null = null) =>
    makeDocument({ authoredBy: 'user', filename, contentType })
  const ingested = () => vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))

  beforeEach(() => {
    vi.mocked(isRenditionEnabled).mockReturnValue(true)
    vi.mocked(ensureRendition).mockReset().mockResolvedValue(RENDITION_KEY)
    vi.mocked(getSignedUrl).mockImplementation(async (_client, command) =>
      (command as { input: { Key: string } }).input.Key === RENDITION_KEY ? RENDITION_URL : ORIGINAL_URL,
    )
    vi.mocked(findDocumentInOrg).mockResolvedValue(officeRow('Baubeschreibung.docx'))
  })

  afterEach(() => {
    vi.mocked(getSignedUrl).mockResolvedValue(ORIGINAL_URL)
    vi.mocked(isRenditionEnabled).mockReturnValue(false)
    vi.mocked(setDocumentIngestJob).mockResolvedValue(true)
  })

  it('answers `processing` at once, and the converter is the job’s to call', async () => {
    await expect(dispatchDocument(input('Baubeschreibung.docx'))).resolves.toEqual({
      jobId: null,
      status: 'processing',
    })
    expect(markDocumentProcessing).toHaveBeenCalledWith('doc-1', 'org-1')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(ensureRendition).not.toHaveBeenCalled()
    expect(queuedJob()).toMatchObject({
      kind: 'office_rendition',
      organizationId: 'org-1',
      priority: 0,
      payload: expect.objectContaining({ documentId: 'doc-1', fileName: 'Baubeschreibung.docx' }),
    })
  })

  it('queues a reindex’s office files behind the people who are waiting', async () => {
    await dispatchDocument({ ...input('Baubeschreibung.docx'), priority: 'bulk' })

    expect(queuedJob()).toMatchObject({ kind: 'office_rendition', priority: 1 })
  })

  it('indexes a Word file from its rendition: preview_ref AND extraction_ref', async () => {
    await dispatchDocument(input('Baubeschreibung.docx'))
    await runQueuedJob()
    await ingested()

    expect(ensureRendition).toHaveBeenCalledWith({
      bucket: 'test-bucket',
      storageKey: 'org/org-1/project/proj-1/doc/doc-1/Baubeschreibung.docx',
      filename: 'Baubeschreibung.docx',
    })
    expect(vi.mocked(ensureRendition).mock.invocationCallOrder[0]).toBeLessThan(
      fetchSpy.mock.invocationCallOrder[0],
    )
    expect(bodyOf(0)).toMatchObject({
      preview_ref: RENDITION_URL,
      extraction_ref: RENDITION_URL,
      file_ref: ORIGINAL_URL,
      file_name: 'Baubeschreibung.docx',
    })
    await vi.waitFor(() => expect(setDocumentIngestJob).toHaveBeenCalledWith('doc-1', 'org-1', 'job-1', null, expect.objectContaining({ ingestJobId: null })))
    const renditionRead = vi
      .mocked(getSignedUrl)
      .mock.calls.find(([, command]) => (command as { input: { Key: string } }).input.Key === RENDITION_KEY)
    expect(renditionRead?.[2]).toEqual({ expiresIn: 86_400 })
  })

  it('indexes a DXF from the page the backend draws, with no Gotenberg at all (ADR-0152)', async () => {
    vi.mocked(isRenditionEnabled).mockReturnValue(false)
    vi.mocked(findDocumentInOrg).mockResolvedValue(officeRow('Katasterauszug.dxf', 'application/dxf'))
    await dispatchDocument(input('Katasterauszug.dxf'))
    await runQueuedJob()
    await ingested()

    expect(ensureRendition).toHaveBeenCalledWith({
      bucket: 'test-bucket',
      storageKey: 'org/org-1/project/proj-1/doc/doc-1/Katasterauszug.dxf',
      filename: 'Katasterauszug.dxf',
    })
    expect(bodyOf(0)).toMatchObject({
      preview_ref: RENDITION_URL,
      extraction_ref: RENDITION_URL,
      file_name: 'Katasterauszug.dxf',
    })
  })

  it('carries the Fassung a person chose through the conversion to the ingest (ADR-0099)', async () => {
    await dispatchDocument({ ...input('Baubeschreibung.docx'), revisionOf: 'Baubeschreibung_Index_A.docx' })

    expect(queuedJob()).toMatchObject({
      kind: 'office_rendition',
      payload: expect.objectContaining({ revisionOf: 'Baubeschreibung_Index_A.docx' }),
    })
    await runQueuedJob()
    await ingested()

    expect(bodyOf(0).revision_of).toBe('Baubeschreibung_Index_A.docx')
  })

  it('carries the chosen document type through the conversion to the ingest', async () => {
    await dispatchDocument({ ...input('Baubeschreibung.docx'), documentType: DOCUMENT_TYPE_TAGS[6] })

    expect(queuedJob()).toMatchObject({
      kind: 'office_rendition',
      payload: expect.objectContaining({ documentType: DOCUMENT_TYPE_TAGS[6] }),
    })
    await runQueuedJob()
    await ingested()

    expect(bodyOf(0).document_type).toBe(DOCUMENT_TYPE_TAGS[6])
  })

  it('carries the mail an attachment came with through the conversion, and drops a queued record that no longer fits', async () => {
    await dispatchDocument({ ...input('Baubeschreibung.docx'), mailOrigin: MAIL_ORIGIN })
    expect(queuedJob()).toMatchObject({ kind: 'office_rendition', payload: expect.objectContaining({ mailOrigin: MAIL_ORIGIN }) })
    await runQueuedJob()
    await ingested()
    expect(bodyOf(0).mail_origin).toEqual(MAIL_ORIGIN)
  })

  it('reads a queued mail record the contract no longer holds as none, and still ingests', async () => {
    await dispatchDocument({ ...input('Baubeschreibung.docx'), mailOrigin: MAIL_ORIGIN })
    queuedJob().payload.mailOrigin = { ...MAIL_ORIGIN, from_address: 'huber@ma37.wien.gv.at' }
    await runQueuedJob()
    await ingested()

    expect(bodyOf(0)).not.toHaveProperty('mail_origin')
  })

  it('reads a queued type the vocabulary no longer holds as no choice, and still ingests', async () => {
    await dispatchDocument({ ...input('Baubeschreibung.docx'), documentType: DOCUMENT_TYPE_TAGS[6] })
    queuedJob().payload.documentType = 'a-retired-token'
    await runQueuedJob()
    await ingested()

    expect(bodyOf(0)).not.toHaveProperty('document_type')
  })

  it('keeps a workbook on its own extractor: preview_ref only', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(officeRow('Kostenschätzung.xlsx'))

    await dispatchDocument(input('Kostenschätzung.xlsx'))
    await runQueuedJob()
    await ingested()

    expect(bodyOf(0).preview_ref).toBe(RENDITION_URL)
    expect(bodyOf(0).extraction_ref).toBeNull()
  })

  it('fails a Word file whose PDF cannot be made, and never reads the original instead', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(ensureRendition).mockRejectedValue(new RenditionFailedError('Office conversion answered 503'))

    await expect(dispatchDocument(input('Baubeschreibung.docx'))).resolves.toEqual({
      jobId: null,
      status: 'processing',
    })
    await expect(runQueuedJob()).resolves.toBeUndefined()

    expect(markDocumentIngestFailed).toHaveBeenCalledWith(
      'doc-1',
      'org-1',
      RENDITION_REQUIRED_MESSAGE,
      ownedBy('Baubeschreibung.docx'),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('tells the reader to export a DXF again when the converter refused its bytes (ADR-0152)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(findDocumentInOrg).mockResolvedValue(officeRow('Katasterauszug.dxf', 'application/dxf'))
    vi.mocked(ensureRendition).mockRejectedValue(
      new RenditionFailedError('Drawing conversion answered 422', { refusedFile: true })
    )

    await dispatchDocument(input('Katasterauszug.dxf'))
    await expect(runQueuedJob()).resolves.toBeUndefined()

    expect(markDocumentIngestFailed).toHaveBeenCalledWith(
      'doc-1',
      'org-1',
      DRAWING_UNREADABLE_MESSAGE,
      ownedBy('Katasterauszug.dxf'),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still ingests a workbook whose PDF cannot be made: it only loses the thumbnail', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(findDocumentInOrg).mockResolvedValue(officeRow('Kostenschätzung.xlsx'))
    vi.mocked(ensureRendition).mockRejectedValue(new RenditionFailedError('Office conversion answered 503'))

    await dispatchDocument(input('Kostenschätzung.xlsx'))
    await runQueuedJob()
    await ingested()

    expect(bodyOf(0).preview_ref).toBeNull()
    expect(bodyOf(0).extraction_ref).toBeNull()
    expect(markDocumentIngestFailed).not.toHaveBeenCalled()
  })

  it('hands a failure around the dispatch back to the queue, and says so on the last attempt', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(setDocumentIngestJob).mockRejectedValue(new Error('database gone'))

    await dispatchDocument(input('Baubeschreibung.docx'))

    await expect(runQueuedJob({ last: false })).rejects.toThrow('database gone')
    expect(markDocumentIngestFailed).not.toHaveBeenCalled()

    await expect(runQueuedJob({ last: true })).rejects.toThrow('database gone')
    expect(markDocumentIngestFailed).toHaveBeenCalledWith(
      'doc-1',
      'org-1',
      INGEST_DISPATCH_FAILED_MESSAGE,
      ownedBy('Baubeschreibung.docx'),
    )
  })

  describe('a job knows its row by its own id, not only by the bytes', () => {
    const waitingFor = (jobId: string | null) =>
      makeDocument({
        authoredBy: 'user',
        filename: 'Baubeschreibung.docx',
        storageKey: input('Baubeschreibung.docx').storageKey,
        status: 'processing',
        metadata: jobId ? { bffJobId: jobId } : {},
      })
    const runAs = async (jobId: string, last = false) => {
      await dispatchDocument(input('Baubeschreibung.docx'))
      vi.mocked(markDocumentProcessing).mockClear()
      return () =>
        runOfficeRenditionJob('org-1', officeRenditionPayloadSchema.parse(queuedJob().payload), { last, jobId })
    }

    it('leaves a row a later job of the same bytes has taken', async () => {
      const run = await runAs('job-earlier')
      vi.mocked(findDocumentInOrg).mockResolvedValue(waitingFor('job-later'))

      await run()

      expect(ensureRendition).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(markDocumentIngestFailed).not.toHaveBeenCalled()
    })

    it('reads the row that names it, and one that names no job yet', async () => {
      const run = await runAs('job-earlier')
      for (const row of [waitingFor('job-earlier'), waitingFor(null)]) {
        fetchSpy.mockClear()
        vi.mocked(findDocumentInOrg).mockResolvedValue(row)
        await run()
        await ingested()
      }
    })

    it('writes its failure under the same identity it checked with', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const run = await runAs('job-earlier', true)
      vi.mocked(findDocumentInOrg).mockResolvedValue(waitingFor('job-earlier'))
      vi.mocked(setDocumentIngestJob).mockRejectedValue(new Error('database gone'))

      await expect(run()).rejects.toThrow('database gone')

      expect(markDocumentIngestFailed).toHaveBeenCalledWith('doc-1', 'org-1', INGEST_DISPATCH_FAILED_MESSAGE, {
        storageKey: input('Baubeschreibung.docx').storageKey,
        backgroundJobId: 'job-earlier',
        unnamedCounts: true,
      })
    })
  })

  it('leaves a row alone that is no longer waiting for the job: deleted, replaced or already moved on', async () => {
    await dispatchDocument(input('Baubeschreibung.docx'))
    const queued = queuedJob()
    const run = () =>
      runOfficeRenditionJob('org-1', officeRenditionPayloadSchema.parse(queued.payload), { last: false })
    const waiting = makeDocument({
      authoredBy: 'user',
      filename: 'Baubeschreibung.docx',
      storageKey: String(queued.payload.storageKey),
      status: 'processing',
    })

    vi.mocked(findDocumentInOrg).mockResolvedValue(null)
    await run()
    vi.mocked(findDocumentInOrg).mockResolvedValue({ ...waiting, storageKey: 'org/org-1/other/doc.docx' })
    await run()
    vi.mocked(findDocumentInOrg).mockResolvedValue({ ...waiting, status: 'pending' })
    await run()

    expect(ensureRendition).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('decides on the row’s stored type too, not only its extension', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      officeRow('Baubeschreibung', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    )

    await expect(dispatchDocument(input('Baubeschreibung'))).resolves.toMatchObject({ status: 'processing' })
    await runQueuedJob()
    await ingested()
    expect(bodyOf(0).preview_ref).toBe(RENDITION_URL)
  })

  it('fails a Word file at once when no converter is configured', async () => {
    vi.mocked(isRenditionEnabled).mockReturnValue(false)

    await expect(dispatchDocument(input('Baubeschreibung.docx'))).resolves.toEqual({
      jobId: null,
      status: 'failed',
    })
    expect(markDocumentIngestFailed).toHaveBeenCalledWith('doc-1', 'org-1', RENDITION_REQUIRED_MESSAGE)
    expect(ensureRendition).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('ingests a workbook synchronously, as before, when no converter is configured', async () => {
    vi.mocked(isRenditionEnabled).mockReturnValue(false)
    vi.mocked(findDocumentInOrg).mockResolvedValue(officeRow('Kostenschätzung.xlsx'))

    await expect(dispatchDocument(input('Kostenschätzung.xlsx'))).resolves.toEqual({
      jobId: 'job-1',
      status: 'pending',
    })
    expect(bodyOf(0).preview_ref).toBeNull()
    expect(bodyOf(0).extraction_ref).toBeNull()
  })

  it('does not convert a PDF, nor a real PDF that happens to be named .docx', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(officeRow('plan.pdf', 'application/pdf'))
    await expect(dispatchDocument(input('plan.pdf'))).resolves.toEqual({ jobId: 'job-1', status: 'pending' })

    vi.mocked(findDocumentInOrg).mockResolvedValue(officeRow('Bericht.docx', 'application/pdf'))
    await expect(dispatchDocument(input('Bericht.docx'))).resolves.toEqual({ jobId: 'job-1', status: 'pending' })

    expect(ensureRendition).not.toHaveBeenCalled()
    expect(markDocumentProcessing).not.toHaveBeenCalled()
    expect(bodyOf(0).preview_ref).toBeNull()
  })

  it('still refuses a machine-written document before anything is converted', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ authoredBy: 'agent', filename: 'piloti/doc-1/bericht.docx' }),
    )

    await expect(dispatchDocument(input('bericht.docx'))).rejects.toThrow(/must not be indexed/)
    expect(markDocumentProcessing).not.toHaveBeenCalled()
    expect(ensureRendition).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
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

describe('dispatchDocument — upload screening', () => {
  const sentBody = (): Record<string, unknown> =>
    JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>

  beforeEach(async () => {
    await invalidateCached('upload-screening:org-1')
  })

  it("sends the suggested content rules for an office that never saved a policy", async () => {
    await dispatchDocument(input('Baubeschreibung.pdf'))
    const screening = sentBody().screening as { content_terms: string[]; detectors: string[] }
    expect(screening.detectors).toEqual(['iban', 'at_svnr', 'credit_card', 'de_svnr', 'de_tax_id'])
    expect(screening.content_terms).toContain('Gehaltsabrechnung')
  })

  it("sends the office's own rules once it saved them", async () => {
    vi.mocked(getOrgSettings).mockResolvedValue({
      displayName: null,
      defaultLocale: 'de',
      homeCountry: null,
      settings: {
        uploadScreening: {
          enabled: true,
          nameTerms: [],
          nameExceptions: [],
          contentTerms: ['Projektkalkulation'],
          detectors: ['iban'],
        },
      },
    })
    await dispatchDocument(input('Baubeschreibung.pdf'))
    expect(sentBody().screening).toEqual({ content_terms: ['Projektkalkulation'], detectors: ['iban'] })
  })

  it('sends no rules when the office switched screening off', async () => {
    vi.mocked(getOrgSettings).mockResolvedValue({
      displayName: null,
      defaultLocale: 'de',
      homeCountry: null,
      settings: {
        uploadScreening: { enabled: false, nameTerms: [], nameExceptions: [], contentTerms: ['x y'], detectors: [] },
      },
    })
    await dispatchDocument(input('Baubeschreibung.pdf'))
    expect(sentBody().screening).toBeNull()
  })

  it('skips screening only for the exact bytes a reviewer released', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ authoredBy: 'user', contentHash: 'sha256:aaa', screeningReleasedHash: 'sha256:aaa' })
    )
    await dispatchDocument(input('Honorar.pdf'))
    expect(sentBody().screening).toBeNull()
  })

  it('screens a re-upload under a released id, because its bytes are new', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ authoredBy: 'user', contentHash: 'sha256:bbb', screeningReleasedHash: 'sha256:aaa' })
    )
    await dispatchDocument(input('Honorar.pdf'))
    expect(sentBody().screening).not.toBeNull()
  })

  it('fails closed when the policy cannot be read: sends nothing, and the row offers a retry', async () => {
    vi.mocked(getOrgSettings).mockRejectedValue(new Error('db down'))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await dispatchDocument(input('Baubeschreibung.pdf'))
    expect(result).toEqual({ jobId: null, status: 'failed' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(markDocumentIngestFailed).toHaveBeenCalledWith('doc-1', 'org-1', INGEST_DISPATCH_FAILED_MESSAGE, expect.objectContaining({ ingestJobId: null }))
    errorLog.mockRestore()
  })
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

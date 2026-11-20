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

vi.mock('@/lib/base-knowledge/text-guard', async () => ({
  isTextHeld: vi.fn(async () => false),
  copyMarkForIngest: vi.fn(async () => null),
  licenceMarkFields: (await vi.importActual<typeof import('@/lib/base-knowledge/office/text-use')>('@/lib/base-knowledge/office/text-use')).licenceMarkFields,
}))

vi.mock('./rendition', async (importOriginal) => {
  const { renditionModuleMock } = await import('@/test-utils/rendition-module')
  return renditionModuleMock(await importOriginal(), false)
})

import { getOrgSettings } from '@/lib/organizations/service'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { bimExtractPayloadSchema, officeRenditionPayloadSchema, type JobAttempt } from '@/lib/jobs-queue/types'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { RenditionFailedError, ensureRendition, isRenditionEnabled } from './rendition'
import { findDocumentInOrg, markDocumentIngestFailed, markDocumentProcessing, setDocumentIngestJob } from './repository'
import { makeDocument } from '@/test-utils/db-fixtures'
import { internalRead } from '@/lib/documents/document-reader'
import { DOCUMENT_TYPE_TAGS } from './tag-vocabulary'
import { dispatchDocument, type DispatchDocumentInput } from './document-dispatch'
import { runBimExtractJob, runOfficeRenditionJob } from './extraction-jobs'
import {
  DRAWING_UNREADABLE_MESSAGE,
  INGEST_DISPATCH_FAILED_MESSAGE,
  RENDITION_REQUIRED_MESSAGE,
} from './ingest-dispatch'

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

const MAIL_ORIGIN = {
  sent_at: '2026-10-14T07:12:00Z',
  received_at: '2026-10-14T07:14:00Z',
  from_name: 'Mag. Anna Huber',
  from_domain: 'ma37.wien.gv.at',
  signer_domain: 'ma37.wien.gv.at',
  sender_trust: 'external_verified' as const,
  locale: 'de' as const,
}

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

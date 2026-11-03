/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureServer = vi.hoisted(() => vi.fn(() => true))
const captureException = vi.hoisted(() => vi.fn())
vi.mock('./posthog-server', () => ({ captureServer, getPosthogServer: () => ({ captureException }) }))

import {
  announceDocumentUploaded,
  announceIngestStarted,
  announceIngestsFinished,
  errorReasonOf,
  fileTypeOf,
  resetIngestFailureLimiterForTests,
} from './ingest-events'

describe('fileTypeOf', () => {
  it('keeps a plain extension, lower-cased, and nothing of the name', () => {
    expect(fileTypeOf('Grundriss EG.PDF')).toBe('pdf')
    expect(fileTypeOf('modell.v2.ifc')).toBe('ifc')
  })

  it('says none for a name without one and other for one that is not plain', () => {
    expect(fileTypeOf('LICENSE')).toBe('none')
    expect(fileTypeOf('Bauakt.Schlussbericht Teil 1')).toBe('other')
    expect(fileTypeOf('weird.extension-too-long')).toBe('other')
  })
})

describe('announceIngestsFinished', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends one personless event per finished upload, in its organization', () => {
    announceIngestsFinished(
      'org-1',
      [
        { filename: 'a.pdf', status: 'completed', pageCount: 3, chunkCount: 9, screening: 'clean' },
        { filename: 'b.docx', status: 'quarantined', screening: 'quarantined' },
      ],
      1_000_000
    )

    expect(captureServer).toHaveBeenCalledTimes(2)
    expect(captureServer).toHaveBeenNthCalledWith(1, {
      event: 'document_ingest_finished',
      distinctId: null,
      organizationId: 'org-1',
      properties: {
        document_id: undefined,
        upload_id: undefined,
        attempt: undefined,
        status: 'completed',
        screening: 'clean',
        error_reason: undefined,
        file_type: 'pdf',
        page_count: 3,
        chunk_count: 9,
        duration_ms: undefined,
        queue_wait_ms: undefined,
        processing_ms: undefined,
        document_id: undefined,
        upload_id: undefined,
        attempt: undefined,
        error_reason: undefined,
        error_category: undefined,
        retryable: undefined,
      },
    })
    expect(captureServer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ properties: expect.objectContaining({ status: 'quarantined', file_type: 'docx' }) })
    )
  })

  it('measures the duration from the row’s last write, and omits it when there is none', () => {
    const now = Date.parse('2026-10-10T12:00:00Z')

    announceIngestsFinished(
      'org-1',
      [
        { filename: 'a.pdf', status: 'completed', updatedAt: '2026-10-10T11:58:30Z' },
        { filename: 'b.pdf', status: 'completed', updatedAt: 'not a date' },
        { filename: 'c.pdf', status: 'completed', updatedAt: '2026-10-10T12:05:00Z' },
      ],
      now
    )

    const durations = captureServer.mock.calls.map(
      (call) => (call as unknown as [{ properties: { duration_ms?: number } }])[0].properties.duration_ms
    )
    expect(durations).toEqual([90_000, undefined, 0])
  })

  it('sends nothing for no finished uploads', () => {
    announceIngestsFinished('org-1', [])

    expect(captureServer).not.toHaveBeenCalled()
  })

  it('joins the attempt to its document, batch and failure class, and splits queueing from work', () => {
    announceIngestsFinished('org-1', [
      {
        documentId: 'doc-1',
        filename: 'a.pdf',
        status: 'failed',
        attempt: 2,
        uploadId: 'batch-1',
        errorMessage: 'interrupted: lost',
        failureCategory: 'transient',
        queueWaitMs: 4_000,
        processingMs: 9_000,
      },
    ])

    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          document_id: 'doc-1',
          attempt: 2,
          upload_id: 'batch-1',
          error_reason: 'interrupted',
          error_category: 'transient',
          queue_wait_ms: 4_000,
          processing_ms: 9_000,
        }),
      })
    )
  })

  it('says not_run when the job carried no screening, instead of leaving the value out', () => {
    announceIngestsFinished('org-1', [{ filename: 'a.pdf', status: 'completed' }])

    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.objectContaining({ screening: 'not_run' }) })
    )
  })
})

describe('announceDocumentUploaded', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends one event per stored file, as the uploader, with its source and no name', () => {
    announceDocumentUploaded('org-1', 'user-1', { source: 'mail', filename: 'Plan.PDF', documentId: 'doc-1', uploadId: null })

    expect(captureServer).toHaveBeenCalledWith({
      event: 'document_uploaded',
      distinctId: 'user-1',
      organizationId: 'org-1',
      properties: {
        source: 'mail',
        file_count: 1,
        document_id: 'doc-1',
        upload_id: undefined,
        file_type: 'pdf',
        replaced: false,
      },
    })
    expect(JSON.stringify(captureServer.mock.calls)).not.toContain('Plan')
  })
})

describe('errorReasonOf', () => {
  it('keeps only the machine prefix of a message', () => {
    expect(errorReasonOf('interrupted: ingestion stopped when the service restarted')).toBe('interrupted')
    expect(errorReasonOf('Kein Text in Grundriss Meier.pdf gefunden')).toBe('unknown')
    expect(errorReasonOf(null)).toBeUndefined()
  })
})

describe('a failed ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIngestFailureLimiterForTests()
  })

  const failed = {
    documentId: 'doc-1',
    filename: 'Grundriss Meier.pdf',
    status: 'failed' as const,
    errorMessage: 'interrupted: the ingestion job was lost; Meier GmbH',
    failureCategory: 'transient',
    retryable: true,
    attempt: 2,
  }

  it('says why on the event, never the text, and reports an exception with office and document', () => {
    announceIngestsFinished('org-1', [failed], 1_000)

    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          document_id: 'doc-1',
          error_reason: 'interrupted',
          error_category: 'transient',
          retryable: true,
          attempt: 2,
        }),
      })
    )
    expect(JSON.stringify(captureServer.mock.calls)).not.toContain('Meier')
    const [error, , properties] = captureException.mock.calls[0] as unknown as [Error, unknown, Record<string, unknown>]
    expect(error.message).toBe('document ingest failed: interrupted')
    expect(properties).toMatchObject({ organization_id: 'org-1', document_id: 'doc-1', error_reason: 'interrupted' })
  })

  it('spends five exceptions per reason in a window, and still sends every event', () => {
    announceIngestsFinished('org-1', Array.from({ length: 109 }, () => failed), 1_000)

    expect(captureServer).toHaveBeenCalledTimes(109)
    expect(captureException).toHaveBeenCalledTimes(5)
  })

  it('reports no exception for a completed or quarantined ingest', () => {
    announceIngestsFinished('org-1', [{ filename: 'a.pdf', status: 'completed' }, { filename: 'b.pdf', status: 'quarantined' }])
    expect(captureException).not.toHaveBeenCalled()
  })
})

describe('announceIngestStarted', () => {
  it('sends the start with the document, job, extension and attempt, never the name', () => {
    announceIngestStarted('org-1', { documentId: 'doc-1', filename: 'Plan Meier.PDF', attempt: 1, jobId: 'job-1' })

    expect(captureServer).toHaveBeenCalledWith({
      event: 'document_ingest_started',
      distinctId: null,
      organizationId: 'org-1',
      properties: { document_id: 'doc-1', job_id: 'job-1', file_type: 'pdf', attempt: 1 },
    })
  })
})

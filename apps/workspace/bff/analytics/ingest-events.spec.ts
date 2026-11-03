/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureServer = vi.hoisted(() => vi.fn(() => true))
vi.mock('./posthog-server', () => ({ captureServer }))

import { announceDocumentUploaded, announceIngestsFinished, fileTypeOf } from './ingest-events'

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
        errorReason: 'transient',
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
          error_reason: 'transient',
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

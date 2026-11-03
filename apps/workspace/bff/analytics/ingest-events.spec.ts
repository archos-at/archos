/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureServer = vi.hoisted(() => vi.fn(() => true))
vi.mock('./posthog-server', () => ({ captureServer }))

import { announceIngestsFinished, fileTypeOf, type FinishedIngest } from './ingest-events'

/** The properties of the nth captured event (0-based). */
const propertiesOf = (n: number): Record<string, unknown> =>
  (captureServer.mock.calls[n] as unknown as [{ properties: Record<string, unknown> }])[0].properties

const ingest = (overrides: Partial<FinishedIngest> = {}): FinishedIngest => ({
  documentId: 'doc-1',
  filename: 'a.pdf',
  status: 'completed',
  ...overrides,
})

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
        ingest({ pageCount: 3, chunkCount: 9, screening: 'clean', attempt: 2 }),
        ingest({ documentId: 'doc-2', filename: 'b.docx', status: 'quarantined', screening: 'quarantined' }),
      ],
      'push',
      1_000_000
    )

    expect(captureServer).toHaveBeenCalledTimes(2)
    expect(captureServer).toHaveBeenNthCalledWith(1, {
      event: 'document_ingest_finished',
      distinctId: null,
      organizationId: 'org-1',
      properties: {
        status: 'completed',
        screening: 'clean',
        file_type: 'pdf',
        page_count: 3,
        chunk_count: 9,
        duration_ms: undefined,
        document_id: 'doc-1',
        attempt: 2,
        failure_category: undefined,
        processing_ms: undefined,
        settled_by: 'push',
      },
    })
    expect(captureServer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        properties: expect.objectContaining({ status: 'quarantined', file_type: 'docx', document_id: 'doc-2' }),
      })
    )
  })

  it('carries which path settled the row', () => {
    announceIngestsFinished('org-1', [ingest()], 'read')
    announceIngestsFinished('org-1', [ingest()], 'sweep')

    expect([propertiesOf(0).settled_by, propertiesOf(1).settled_by]).toEqual(['read', 'sweep'])
  })

  it('sends the stored failure category for a failed row only, and never the filename', () => {
    announceIngestsFinished(
      'org-1',
      [
        ingest({ status: 'failed', failureCategory: 'deterministic', filename: 'Bescheid Müller.pdf' }),
        ingest({ status: 'completed', failureCategory: 'transient' }),
        ingest({ status: 'failed', failureCategory: null }),
      ],
      'push'
    )

    expect(propertiesOf(0).failure_category).toBe('deterministic')
    expect(propertiesOf(1).failure_category).toBeUndefined()
    expect(propertiesOf(2).failure_category).toBeUndefined()
    expect(JSON.stringify(captureServer.mock.calls)).not.toContain('Müller')
  })

  it('omits an attempt the row does not carry', () => {
    announceIngestsFinished('org-1', [ingest({ attempt: null }), ingest({ attempt: 1 })], 'read')

    expect([propertiesOf(0).attempt, propertiesOf(1).attempt]).toEqual([undefined, 1])
  })

  it('measures processing from the job’s start to its end, reading a naive backend time as UTC', () => {
    announceIngestsFinished(
      'org-1',
      [
        // What `datetime.utcnow()` serializes to: no offset, microseconds.
        ingest({ jobStartedAt: '2026-11-03T10:00:00.250000', jobCompletedAt: '2026-11-03T10:01:30.250000' }),
        ingest({ jobStartedAt: '2026-11-03T10:00:00Z', jobCompletedAt: '2026-11-03T11:00:05+01:00' }),
        ingest({ jobStartedAt: null, jobCompletedAt: '2026-11-03T10:01:30' }),
        ingest({ jobStartedAt: '2026-11-03T10:05:00', jobCompletedAt: '2026-11-03T10:01:30' }),
        ingest({ jobStartedAt: 'not a time', jobCompletedAt: 12 }),
      ],
      'push'
    )

    expect([0, 1, 2, 3, 4].map((n) => propertiesOf(n).processing_ms)).toEqual([
      90_000,
      5_000,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('measures the duration from the row’s last write, and omits it when there is none', () => {
    const now = Date.parse('2026-10-10T12:00:00Z')

    announceIngestsFinished(
      'org-1',
      [
        ingest({ updatedAt: '2026-10-10T11:58:30Z' }),
        ingest({ updatedAt: 'not a date' }),
        ingest({ updatedAt: '2026-10-10T12:05:00Z' }),
      ],
      'read',
      now
    )

    expect([0, 1, 2].map((n) => propertiesOf(n).duration_ms)).toEqual([90_000, undefined, 0])
  })

  it('sends nothing for no finished uploads', () => {
    announceIngestsFinished('org-1', [], 'push')

    expect(captureServer).not.toHaveBeenCalled()
  })
})

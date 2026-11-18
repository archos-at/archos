/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/upload-batches/settle', () => ({ onDocumentsSettled: vi.fn().mockResolvedValue(undefined) }))

const captureServer = vi.hoisted(() => vi.fn(() => true))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer, getPosthogServer: () => null }))

vi.mock('./shelf-live', () => ({ publishShelfChanged: vi.fn() }))

vi.mock('@/lib/search/facets-projector', () => ({ projectReadings: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/search/facets-repository', () => ({ listCollectionDocumentsForProjection: vi.fn().mockResolvedValue([]) }))

const findIngestAnnouncementFacts = vi.hoisted(() => vi.fn(async () => new Map<string, { attempt: number | null; uploadBatchId: string | null }>()))
vi.mock('./repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repository')>()),
  findIngestAnnouncementFacts,
}))

import { makeDbMock, makeRow, mockFetch, collectionResponse } from './reconcile-status.fixtures'
import { reconcileDocumentStatuses, clearCollectionFilesCache, readRevisionLinkNames, refreshCollectionFiles, readCollectionReadings } from './reconcile-status'
import { collectionFileRef } from './collection-file-ref'

describe('reconcileDocumentStatuses metadata enrichment', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('merges summary, page/chunk counts, content types, and tags onto a row', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([
        {
          file_id: 'f-1',
          file_name: 'plan.pdf',
          status: 'success',
          summary: 'A ground-floor plan.',
          chunk_count: 12,
          tags: ['Grundriss', 'Brandschutz'],
          metadata: { page_count: 4, content_types: ['text', 'table'] },
        },
      ])
    )

    const [result] = await reconcileDocumentStatuses([makeRow({ status: 'completed' })], 'org-1', 'read')

    expect(result.summary).toBe('A ground-floor plan.')
    expect(result.pageCount).toBe(4)
    expect(result.chunkCount).toBe(12)
    expect(result.contentTypes).toEqual(['text', 'table'])
    expect(result.tags).toEqual(['Grundriss', 'Brandschutz'])
  })

  it('omits tags when the backend provides an empty tag list', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([
        { file_id: 'f-1', file_name: 'plan.pdf', status: 'success', chunk_count: 5, tags: [] },
      ])
    )

    const [result] = await reconcileDocumentStatuses([makeRow({ status: 'completed' })], 'org-1', 'read')

    expect(result.tags).toBeUndefined()
  })

  it('merges topics and the photo capture, mapped to camelCase', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([
        {
          file_id: 'f-1',
          file_name: 'plan.pdf',
          status: 'success',
          topics: ['Brandschutzkonzept', 'Fluchtweg'],
          capture: { captured_at: '2026-03-14T09:21:00', latitude: 47.07, longitude: 15.44, camera: 'Canon EOS R6' },
        },
      ])
    )

    const [result] = await reconcileDocumentStatuses([makeRow({ status: 'completed' })], 'org-1', 'read')

    expect(result.topics).toEqual(['Brandschutzkonzept', 'Fluchtweg'])
    expect(result.capture).toEqual({
      capturedAt: '2026-03-14T09:21:00',
      latitude: 47.07,
      longitude: 15.44,
      camera: 'Canon EOS R6',
    })
  })

  it('drops junk topics and an unusable capture, keeping what is valid', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([
        {
          file_id: 'f-1',
          file_name: 'plan.pdf',
          status: 'success',
          topics: ['Fluchtweg', '', 7, null, 'Rauchabzug'],
          capture: { latitude: 47.07, camera: 42 },
        },
      ])
    )

    const [result] = await reconcileDocumentStatuses([makeRow({ status: 'completed' })], 'org-1', 'read')

    expect(result.topics).toEqual(['Fluchtweg', 'Rauchabzug'])
    expect(result.capture).toBeUndefined()
  })

  it('omits topics and capture when the backend provides none or only empty ones', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([
        { file_id: 'f-1', file_name: 'plan.pdf', status: 'success', chunk_count: 5, topics: [], capture: null },
      ])
    )

    const [result] = await reconcileDocumentStatuses([makeRow({ status: 'completed' })], 'org-1', 'read')

    expect(result.topics).toBeUndefined()
    expect(result.capture).toBeUndefined()
  })

  it('merges the title-block facts, mapped to camelCase, and drops junk ones', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([
        {
          file_id: 'f-1',
          file_name: 'plan.pdf',
          status: 'success',
          revision_facts: {
            document_number: 'A-101',
            revision: 'C',
            revision_date: '2026-03-14',
            page: 2,
          },
        },
        {
          file_id: 'f-2',
          file_name: 'junk.pdf',
          status: 'success',
          revision_facts: { revision_date: '14.03.2026' },
        },
      ])
    )

    const [present, junk] = await reconcileDocumentStatuses(
      [
        makeRow({ status: 'completed' }),
        makeRow({ id: 'doc-2', filename: 'junk.pdf', status: 'completed' }),
      ],
      'org-1',
      'read'
    )

    expect(present.revisionFacts).toEqual({
      documentNumber: 'A-101',
      revision: 'C',
      revisionDate: '2026-03-14',
      page: 2,
    })
    expect(junk.revisionFacts).toBeUndefined()
  })

  it('merges the dossier, references and coverage, parsed, and drops junk ones', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([
        {
          file_id: 'f-1',
          file_name: 'plan.pdf',
          status: 'success',
          dossier: {
            version: 1,
            document_type: 'submission_drawing',
            facts: [{ key: 'storeys_above_ground', value: '4', unit: null, page: 1, quote: '4 oberirdische Geschosse' }],
          },
          doc_references: [{ kind: 'plan', key: 'ep-05', label: 'EP-05', pages: [1] }],
          coverage: { pages: 40, text: 30, transcribed: 5, drawings: 5, drawings_read: 3, not_read: 2, reasons: { render_cap: 2 } },
        },
        {
          file_id: 'f-2',
          file_name: 'junk.pdf',
          status: 'success',
          dossier: { document_type: 'novel' },
          doc_references: [{ kind: 'rumour', key: 'x' }],
          coverage: { pages: 0 },
        },
      ])
    )

    const [present, junk] = await reconcileDocumentStatuses(
      [makeRow({ status: 'completed' }), makeRow({ id: 'doc-2', filename: 'junk.pdf', status: 'completed' })],
      'org-1',
      'read'
    )

    expect(present.dossier?.documentType).toBe('submission_drawing')
    expect(present.dossier?.facts).toEqual([
      { key: 'storeys_above_ground', value: '4', unit: null, page: 1, quote: '4 oberirdische Geschosse' },
    ])
    expect(present.docReferences).toEqual([{ kind: 'plan', key: 'ep-05', label: 'EP-05', pages: [1] }])
    expect(present.coverage).toMatchObject({ pages: 40, notRead: 2, drawingsRead: 3, reasons: { render_cap: 2 } })
    expect(junk.dossier).toBeUndefined()
    expect(junk.docReferences).toBeUndefined()
    expect(junk.coverage).toBeUndefined()
  })

  it('reads the Fassung links by file name and keeps them out of the row metadata', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([
        {
          file_id: 'f-1',
          file_name: 'plan.pdf',
          status: 'success',
          superseded_by: 'plan_B.pdf',
          supersedes: ['plan_0.pdf'],
          revision_suggestion: { of: 'plan_0.pdf', confidence: 2, reason: 'Index', basis: 'name' },
          change_summary: 'Wand entfällt.',
          change_basis: 'plan_0.pdf',
        },
      ])
    )
    const row = makeRow({ status: 'completed' })

    const [result] = await reconcileDocumentStatuses([row], 'org-1', 'read')

    expect(JSON.stringify(result)).not.toContain('plan_B.pdf')
    expect(JSON.stringify(result)).not.toContain('plan_0.pdf')
    const ref = collectionFileRef(row)
    if (!ref) throw new Error('a human row has a ref')
    expect(await readRevisionLinkNames(ref)).toEqual({
      supersededBy: 'plan_B.pdf',
      supersedes: ['plan_0.pdf'],
      suggestion: { of: 'plan_0.pdf', confidence: 1, reason: 'Index', basis: 'name' },
      change: { text: 'Wand entfällt.', basis: 'plan_0.pdf' },
    })
  })

  it('answers no Fassung names for a file the listing does not know, a name it lists twice, or a file with none', async () => {
    mockFetch.mockResolvedValue(
      collectionResponse([
        { file_name: 'plan.pdf', status: 'success', superseded_by: 'a.pdf' },
        { file_name: 'plan.pdf', status: 'success', superseded_by: 'b.pdf' },
        { file_name: 'leer.pdf', status: 'success' },
      ])
    )
    const ref = (filename: string) => {
      const found = collectionFileRef(makeRow({ filename }))
      if (!found) throw new Error('a human row has a ref')
      return found
    }

    expect(await readRevisionLinkNames(ref('plan.pdf'))).toBeNull()
    expect(await readRevisionLinkNames(ref('leer.pdf'))).toBeNull()
    expect(await readRevisionLinkNames(ref('fehlt.pdf'))).toBeNull()
  })

  it('refreshes the cached listing, so the read after a write sees it', async () => {
    mockFetch.mockResolvedValueOnce(collectionResponse([{ file_name: 'plan.pdf', status: 'success' }]))
    const ref = collectionFileRef(makeRow())
    if (!ref) throw new Error('a human row has a ref')
    expect(await readRevisionLinkNames(ref)).toBeNull()

    mockFetch.mockResolvedValueOnce(
      collectionResponse([{ file_name: 'plan.pdf', status: 'success', superseded_by: 'plan_B.pdf' }])
    )
    await refreshCollectionFiles('proj_abc')

    expect((await readRevisionLinkNames(ref))?.supersededBy).toBe('plan_B.pdf')
  })

  it('omits fields the backend did not provide', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([{ file_id: 'f-1', file_name: 'plan.pdf', status: 'success', chunk_count: 5 }])
    )

    const [result] = await reconcileDocumentStatuses([makeRow({ status: 'completed' })], 'org-1', 'read')

    expect(result.chunkCount).toBe(5)
    expect(result.summary).toBeUndefined()
    expect(result.pageCount).toBeUndefined()
    expect(result.contentTypes).toBeUndefined()
  })

  it('shows no metadata when the filename is ambiguous within the collection', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(
      collectionResponse([
        { file_id: 'f-1', file_name: 'plan.pdf', status: 'success', summary: 'First.', chunk_count: 3 },
        { file_id: 'f-2', file_name: 'plan.pdf', status: 'success', summary: 'Second.', chunk_count: 9 },
      ])
    )

    const [result] = await reconcileDocumentStatuses([makeRow({ status: 'completed' })], 'org-1', 'read')

    expect(result.summary).toBeUndefined()
    expect(result.chunkCount).toBeUndefined()
  })

  it('adds no metadata when the backend file list is unreachable (fail-open)', async () => {
    makeDbMock()
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const [result] = await reconcileDocumentStatuses([makeRow({ status: 'completed' })], 'org-1', 'read')

    expect(result.status).toBe('completed')
    expect(result.summary).toBeUndefined()
    expect(result.chunkCount).toBeUndefined()
  })

  it('adds no metadata when the document is absent from the collection list', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(collectionResponse([{ file_id: 'f-9', file_name: 'other.pdf', status: 'success' }]))

    const [result] = await reconcileDocumentStatuses([makeRow({ status: 'completed' })], 'org-1', 'read')

    expect(result.summary).toBeUndefined()
    expect(result.chunkCount).toBeUndefined()
  })

  const expertReportListing = () =>
    collectionResponse([
      {
        file_id: 'f-1',
        file_name: 'brandschutz-gutachten-2026-08-20.pdf',
        status: 'success',
        summary: 'Gutachten zum Brandschutzkonzept, Bauteil B.',
        chunk_count: 42,
        tags: ['Gutachten', 'Brandschutz'],
        metadata: { page_count: 31, content_types: ['text', 'table'] },
      },
    ])

  const collidingRow = (authoredBy: 'user' | 'agent') =>
    makeRow({
      id: authoredBy === 'agent' ? 'doc-agent' : 'doc-human',
      status: authoredBy === 'agent' ? 'stored' : 'completed',
      filename: 'brandschutz-gutachten-2026-08-20.pdf',
      authoredBy,
    })

  it('gives a machine-authored row none of the colliding human document\'s metadata', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(expertReportListing())

    const [result] = await reconcileDocumentStatuses([collidingRow('agent')], 'org-1', 'read')

    expect(result.summary).toBeUndefined()
    expect(result.pageCount).toBeUndefined()
    expect(result.chunkCount).toBeUndefined()
    expect(result.contentTypes).toBeUndefined()
    expect(result.tags).toBeUndefined()
    expect(result.status).toBe('stored')
  })

  it('still enriches the human document that owns the colliding filename', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(expertReportListing())

    const [result] = await reconcileDocumentStatuses([collidingRow('user')], 'org-1', 'read')

    expect(result.summary).toBe('Gutachten zum Brandschutzkonzept, Bauteil B.')
    expect(result.pageCount).toBe(31)
    expect(result.tags).toEqual(['Gutachten', 'Brandschutz'])
  })

  it('does not fetch a collection listing for a read of machine-authored rows only', async () => {
    makeDbMock()
    mockFetch.mockResolvedValue(expertReportListing())

    await reconcileDocumentStatuses([collidingRow('agent')], 'org-1', 'read')

    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('readCollectionReadings', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    clearCollectionFilesCache()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const ref = collectionFileRef(makeRow())
  const file = { file_name: 'plan.pdf', status: 'success', summary: 'A plan.', superseded_by: 'plan-b.pdf' }

  it('reads each named file\'s reading and whether a newer Fassung replaces it', async () => {
    mockFetch.mockResolvedValue(collectionResponse([file]))
    const readings = await readCollectionReadings('proj_abc', ref ? [ref] : [])
    expect(readings?.get('plan.pdf')).toEqual({ metadata: { summary: 'A plan.' }, superseded: true })
  })

  it('says nothing when the backend listed the files without their reading, so nothing is blanked', async () => {
    mockFetch.mockResolvedValue({ ...collectionResponse([file]), headers: new Headers({ 'X-Grid-Reading-Unavailable': '1' }) })
    expect(await readCollectionReadings('proj_abc', ref ? [ref] : [])).toBeNull()
  })
})

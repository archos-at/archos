/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/backend-proxy', () => ({
  getBackendUrl: vi.fn().mockReturnValue('http://backend:8000'),
}))

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  inArray: (column: unknown, values: unknown[]) => ({ column, values }),
}))
vi.mock('@/lib/db/schema/documents', () => ({
  documents: {
    collectionName: 'collection_name',
    filename: 'filename',
    authoredBy: 'authored_by',
    publishedVersionId: 'published_version_id',
  },
}))

const { conversationsTable } = vi.hoisted(() => ({ conversationsTable: { id: 'conversation_id' } }))
vi.mock('@/lib/db/schema/conversations', () => ({ conversations: conversationsTable }))

const syncAllProjectFacts = vi.fn()
vi.mock('@/lib/cross-project/project-facts-mirror', () => ({
  syncAllProjectFacts: (...args: unknown[]) => syncAllProjectFacts(...args),
}))

import { getDb } from '@/lib/db'
import { asDb } from '@/test-utils/db-fixtures'
import { agentDocumentFilename } from '@/lib/documents/agent-namespace'
import { DOCUMENT_FACTS_BATCH, PROJECT_FACTS_FAILURE_NAME, TENANT_SCOPES_FAILURE_NAME, reconcileOrphanedVectors } from './vector-reconcile'

describe('reconcileOrphanedVectors: the project facts half', () => {
  const fetchFacts = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchFacts)
    vi.mocked(getDb).mockReturnValue(asDb({ select: () => ({ from: () => Promise.resolve([]) }) }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('copies every project’s facts onto its chunks, and reports what it did', async () => {
    syncAllProjectFacts.mockResolvedValueOnce({ projects: 3, failed: 1, unsupported: false })
    const result = await reconcileOrphanedVectors()
    expect(result.projectFacts).toEqual({ projects: 3, failed: 1, unsupported: false })
  })

  it('records its failure without undoing the halves before it', async () => {
    syncAllProjectFacts.mockRejectedValueOnce(new Error('db down'))
    const result = await reconcileOrphanedVectors()
    expect(result.projectFacts).toBeUndefined()
    expect(result.failures).toContainEqual({ collectionName: PROJECT_FACTS_FAILURE_NAME, error: 'project facts: db down' })
  })
})

const fetchMock = vi.fn()

type Row = {
  id?: string
  collectionName: string
  filename: string
  authoredBy: string
  authoredByProducer?: string | null
  publishedVersionId?: string | null
}

function stubRows(rows: Row[], now: Row[] = rows, liveConversations: string[] = []) {
  const from = (table: unknown) =>
    table === conversationsTable
      ? { where: (condition: { values: string[] }) => Promise.resolve(liveConversations.filter((id) => condition.values.includes(id)).map((id) => ({ id }))) }
      : Object.assign(Promise.resolve(rows), {
          where: (condition: { value: string }) => Promise.resolve(now.filter((row) => row.collectionName === condition.value)),
        })
  vi.mocked(getDb).mockReturnValue(asDb({ select: () => ({ from }) }))
}

function listResponse(names: string[]) {
  return { ok: true, json: () => Promise.resolve(names.map((file_name) => ({ file_name }))) }
}

function deleteResponse(totalDeleted: number) {
  return { ok: true, json: () => Promise.resolve({ total_deleted: totalDeleted }) }
}

function summaryResponse(forgotten: { collection: string; file_name: string }[], failures: { collection: string; error: string }[] = []) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        status: 'ok',
        dry_run: false,
        orphans_found: forgotten.length,
        orphans_forgotten: forgotten.length,
        forgotten,
        failures,
      }),
  }
}

const DOCUMENT_FACTS_URL = 'http://backend:8000/v1/maintenance/refresh-document-facts'
const TENANT_SCOPES_URL = 'http://backend:8000/v1/maintenance/tenant-scopes'

function scopesResponse(scopes: string[]) {
  return { ok: true, status: 200, json: () => Promise.resolve({ status: 'ok', scopes }) }
}

function callsBeforeDocumentFacts() {
  return fetchMock.mock.calls.filter((call) => call[0] !== DOCUMENT_FACTS_URL && call[0] !== TENANT_SCOPES_URL)
}

function summaryCall() {
  const calls = callsBeforeDocumentFacts()
  const call = calls[calls.length - 1]
  return { url: call[0] as string, init: call[1] as RequestInit }
}

describe('reconcileOrphanedVectors', () => {
  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-token')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation((url: string) => Promise.resolve(url === TENANT_SCOPES_URL ? scopesResponse([]) : summaryResponse([])))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('keeps the passages of a published agent document, which its row owns', async () => {
    const published = agentDocumentFilename('doc_1', 'Brandschutzkonzept.md')
    stubRows([
      { collectionName: 'proj_a', filename: published, authoredBy: 'agent', authoredByProducer: 'agent_document', publishedVersionId: 'ver_1' },
    ])
    fetchMock.mockResolvedValueOnce(listResponse([published, 'geloescht.pdf']))
    fetchMock.mockResolvedValueOnce(deleteResponse(3))

    const result = await reconcileOrphanedVectors()

    expect(result.orphansFound).toBe(1)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ file_ids: ['geloescht.pdf'] })
  })

  it('keeps a document that was published between the scan and the re-read before the delete', async () => {
    const filename = agentDocumentFilename('doc_2', 'Entwurf.md')
    stubRows(
      [{ collectionName: 'proj_a', filename, authoredBy: 'agent', authoredByProducer: 'agent_document' }],
      [{ collectionName: 'proj_a', filename, authoredBy: 'agent', authoredByProducer: 'agent_document', publishedVersionId: 'ver_1' }],
    )
    fetchMock.mockResolvedValueOnce(listResponse([filename]))

    await reconcileOrphanedVectors()

    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)
  })

  it('does not let an unpublished machine-authored row shield an orphan that shares its name', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'sicherheitskonzept.pdf', authoredBy: 'agent' }])
    fetchMock.mockResolvedValueOnce(listResponse(['sicherheitskonzept.pdf']))
    fetchMock.mockResolvedValueOnce(deleteResponse(7))

    const result = await reconcileOrphanedVectors()

    expect(result.orphansFound).toBe(1)
    expect(result.orphansDeleted).toBe(7)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ file_ids: ['sicherheitskonzept.pdf'] })
  })

  it('still scans a collection whose only remaining rows are machine-authored', async () => {
    stubRows([
      { collectionName: 'proj_a', filename: 'bericht-2026-08-20.pdf', authoredBy: 'agent' },
    ])
    fetchMock.mockResolvedValueOnce(listResponse(['geloescht.pdf']))
    fetchMock.mockResolvedValueOnce(deleteResponse(4))

    const result = await reconcileOrphanedVectors()

    expect(result.collectionsScanned).toBe(1)
    expect(result.orphansDeleted).toBe(4)
  })

  it('keeps a user row live even when a machine-authored row shares its name', async () => {
    stubRows([
      { collectionName: 'proj_a', filename: 'plan.pdf', authoredBy: 'agent' },
      { collectionName: 'proj_a', filename: 'plan.pdf', authoredBy: 'user' },
    ])
    fetchMock.mockResolvedValueOnce(listResponse(['plan.pdf']))

    const result = await reconcileOrphanedVectors()

    expect(result.orphansFound).toBe(0)
    expect(callsBeforeDocumentFacts()).toHaveLength(2)
  })

  it('shields only `user`, so an author value nobody has added yet owns no chunks', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'import.pdf', authoredBy: 'import' }])
    fetchMock.mockResolvedValueOnce(listResponse(['import.pdf']))
    fetchMock.mockResolvedValueOnce(deleteResponse(2))

    const result = await reconcileOrphanedVectors()

    expect(result.orphansFound).toBe(1)
  })

  it('deletes a chunk whose document row is gone, keeps live ones', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'live.pdf', authoredBy: 'user' }])
    fetchMock.mockResolvedValueOnce(listResponse(['live.pdf', 'ghost.pdf']))
    fetchMock.mockResolvedValueOnce(deleteResponse(3))

    const result = await reconcileOrphanedVectors()

    expect(result.collectionsScanned).toBe(1)
    expect(result.orphansFound).toBe(1)
    expect(result.orphansDeleted).toBe(3)
    expect(result.failures).toEqual([])
    const deleteCall = fetchMock.mock.calls[1]
    expect(deleteCall[1].method).toBe('DELETE')
    expect(JSON.parse(deleteCall[1].body)).toEqual({ file_ids: ['ghost.pdf'] })
  })

  it('keeps a fetched law text beside an attachment in a live conversation, and still purges a deleted attachment by its id', async () => {
    stubRows([{ id: 'doc-anhang', collectionName: 's_lebendig', filename: 'Anhang.pdf', authoredBy: 'user' }], undefined, ['s_lebendig'])
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          { file_name: 'Anhang.pdf', document_id: 'doc-anhang' },
          { file_name: 'RIS_Bauordnung_LBO.txt' },
          { file_name: 'Alt.pdf', document_id: 'doc-weg' },
        ]),
    })
    fetchMock.mockResolvedValueOnce(deleteResponse(2))

    const result = await reconcileOrphanedVectors()

    expect(result.sparedInLiveConversations).toBe(1)
    expect(result.orphansFound).toBe(1)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ file_ids: ['Alt.pdf'], documents: [{ id: 'doc-weg', file_name: 'Alt.pdf' }], by_id_only: true })
  })

  describe('by document id', () => {
    const listedWithIds = (files: Array<{ file_name: string; document_id?: string }>) => ({ ok: true, json: () => Promise.resolve(files) })

    it('purges the chunks of a deleted document by its id, though a live document in another folder has its name', async () => {
      stubRows([{ id: 'doc-einreichung', collectionName: 'proj_a', filename: 'Plan.pdf', authoredBy: 'user' }])
      fetchMock.mockResolvedValueOnce(
        listedWithIds([
          { file_name: 'Plan.pdf', document_id: 'doc-einreichung' },
          { file_name: 'Plan.pdf', document_id: 'doc-entwurf-geloescht' },
        ])
      )
      fetchMock.mockResolvedValueOnce(deleteResponse(6))

      const result = await reconcileOrphanedVectors()

      expect(result.orphansFound).toBe(1)
      expect(result.orphansDeleted).toBe(6)
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
        file_ids: ['Plan.pdf'],
        documents: [{ id: 'doc-entwurf-geloescht', file_name: 'Plan.pdf' }],
      })
    })

    it('keeps every live document’s chunks when two of them share a name', async () => {
      stubRows([
        { id: 'doc-entwurf', collectionName: 'proj_a', filename: 'Plan.pdf', authoredBy: 'user' },
        { id: 'doc-einreichung', collectionName: 'proj_a', filename: 'Plan.pdf', authoredBy: 'user' },
      ])
      fetchMock.mockResolvedValueOnce(
        listedWithIds([
          { file_name: 'Plan.pdf', document_id: 'doc-entwurf' },
          { file_name: 'Plan.pdf', document_id: 'doc-einreichung' },
        ])
      )

      const result = await reconcileOrphanedVectors()

      expect(result.orphansFound).toBe(0)
      expect(callsBeforeDocumentFacts().some((call) => call[1]?.method === 'DELETE')).toBe(false)
    })

    it('purges chunks without a document id by name and chunks with one by id, in one sweep', async () => {
      stubRows([{ id: 'doc-live', collectionName: 'proj_a', filename: 'live.pdf', authoredBy: 'user' }])
      fetchMock.mockResolvedValueOnce(
        listedWithIds([
          { file_name: 'live.pdf', document_id: 'doc-live' },
          { file_name: 'alt.pdf', document_id: 'doc-gone' },
          { file_name: 'ghost.pdf' },
        ])
      )
      fetchMock.mockResolvedValueOnce(deleteResponse(2))
      fetchMock.mockResolvedValueOnce(deleteResponse(1))

      const result = await reconcileOrphanedVectors()

      expect(result.orphansFound).toBe(2)
      expect(result.orphansDeleted).toBe(3)
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ file_ids: ['alt.pdf'], documents: [{ id: 'doc-gone', file_name: 'alt.pdf' }] })
      expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ file_ids: ['ghost.pdf'] })
    })
  })

  it('does not delete the chunks of a document filed after the snapshot was taken', async () => {
    const before = [{ collectionName: 'proj_a', filename: 'live.pdf', authoredBy: 'user' }]
    stubRows(before, [...before, { collectionName: 'proj_a', filename: 'Neu hochgeladen.pdf', authoredBy: 'user' }])
    fetchMock.mockResolvedValueOnce(listResponse(['live.pdf', 'Neu%20hochgeladen.pdf', 'ghost.pdf']))
    fetchMock.mockResolvedValueOnce(deleteResponse(2))

    const result = await reconcileOrphanedVectors()

    expect(result.orphansFound).toBe(1)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ file_ids: ['ghost.pdf'] })
  })

  it('deletes nothing in a collection whose every candidate turned out live on the second look', async () => {
    const before = [{ collectionName: 'proj_a', filename: 'live.pdf', authoredBy: 'user' }]
    stubRows(before, [...before, { collectionName: 'proj_a', filename: 'neu.pdf', authoredBy: 'user' }])
    fetchMock.mockResolvedValueOnce(listResponse(['live.pdf', 'neu.pdf']))

    const result = await reconcileOrphanedVectors()

    expect(result.orphansFound).toBe(0)
    expect(callsBeforeDocumentFacts().some((call) => call[1]?.method === 'DELETE')).toBe(false)
  })

  it('treats a live document stored under a percent-encoded name as live (regression)', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'Zürich Plan.pdf', authoredBy: 'user' }])
    fetchMock.mockResolvedValueOnce(listResponse(['Z%C3%BCrich%20Plan.pdf']))

    const result = await reconcileOrphanedVectors()

    expect(result.orphansFound).toBe(0)
    expect(result.orphansDeleted).toBe(0)
    expect(callsBeforeDocumentFacts()).toHaveLength(2)
  })

  it('deletes an orphan stored under an encoded name (the historical leak)', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'other.pdf', authoredBy: 'user' }])
    fetchMock.mockResolvedValueOnce(listResponse(['other.pdf', 'Alte%20Datei.pdf']))
    fetchMock.mockResolvedValueOnce(deleteResponse(5))

    const result = await reconcileOrphanedVectors()

    expect(result.orphansFound).toBe(1)
    expect(result.orphansDeleted).toBe(5)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ file_ids: ['Alte%20Datei.pdf'] })
  })

  it('never scans a collection that has no document rows (e.g. the OIB corpus)', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' }])
    fetchMock.mockResolvedValueOnce(listResponse(['a.pdf']))

    const result = await reconcileOrphanedVectors()

    expect(result.collectionsScanned).toBe(1)
    expect(callsBeforeDocumentFacts()).toHaveLength(2)
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/collections/proj_a/documents')
    expect(JSON.parse(summaryCall().init.body as string)).toEqual({ collections: ['proj_a'], dry_run: false })
  })

  it('records a per-collection failure and continues', async () => {
    stubRows([
      { collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' },
      { collectionName: 'proj_b', filename: 'b.pdf', authoredBy: 'user' },
    ])
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    fetchMock.mockResolvedValueOnce(listResponse(['b.pdf']))

    const result = await reconcileOrphanedVectors()

    expect(result.collectionsScanned).toBe(2)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].collectionName).toBe('proj_a')
  })

  it('forgets chunk-less summaries in the collections it just walked, after the chunk pass', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'live.pdf', authoredBy: 'user' }])
    fetchMock.mockResolvedValueOnce(listResponse(['live.pdf', 'ghost.pdf']))
    fetchMock.mockResolvedValueOnce(deleteResponse(3))
    fetchMock.mockResolvedValueOnce(summaryResponse([{ collection: 'proj_a', file_name: 'alt.pdf' }]))

    const result = await reconcileOrphanedVectors()

    expect(result.orphansDeleted).toBe(3)
    expect(result.summariesForgotten).toBe(1)
    expect(result.failures).toEqual([])
    const { url, init } = summaryCall()
    expect(url).toBe('http://backend:8000/v1/maintenance/reconcile-summaries')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ collections: ['proj_a'], dry_run: false })
    expect(callsBeforeDocumentFacts()).toHaveLength(3)
  })

  it('sends the internal token the maintenance route is guarded by', async () => {
    vi.stubEnv('INTERNAL_API_TOKEN', 'real-secret')
    stubRows([{ collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' }])
    fetchMock.mockResolvedValueOnce(listResponse(['a.pdf']))

    await reconcileOrphanedVectors()

    const headers = summaryCall().init.headers as Record<string, string>
    expect(headers['x-internal-token']).toBe('real-secret')
    vi.unstubAllEnvs()
  })

  it('records a per-collection summary failure under that collection, and keeps the chunk result', async () => {
    stubRows([
      { collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' },
      { collectionName: 'proj_b', filename: 'b.pdf', authoredBy: 'user' },
    ])
    fetchMock.mockResolvedValueOnce(listResponse(['a.pdf', 'ghost.pdf']))
    fetchMock.mockResolvedValueOnce(deleteResponse(2))
    fetchMock.mockResolvedValueOnce(listResponse(['b.pdf']))
    fetchMock.mockResolvedValueOnce(
      summaryResponse([{ collection: 'proj_a', file_name: 'x.pdf' }], [{ collection: 'proj_b', error: 'chroma timeout' }]),
    )

    const result = await reconcileOrphanedVectors()

    expect(result.orphansDeleted).toBe(2)
    expect(result.summariesForgotten).toBe(1)
    expect(result.failures).toEqual([{ collectionName: 'proj_b', error: 'summary reconcile: chroma timeout' }])
  })

  it('a refused summary sweep is one recorded failure, not a failed run', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' }])
    fetchMock.mockResolvedValueOnce(listResponse(['a.pdf', 'ghost.pdf']))
    fetchMock.mockResolvedValueOnce(deleteResponse(5))
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })

    const result = await reconcileOrphanedVectors()

    expect(result.orphansDeleted).toBe(5)
    expect(result.summariesForgotten).toBe(0)
    expect(result.failures).toEqual([{ collectionName: '*', error: 'summary reconcile: reconcile-summaries returned 503' }])
  })

  it('does not call the backend for summaries when no collection is live', async () => {
    stubRows([])

    const result = await reconcileOrphanedVectors()

    expect(result.collectionsScanned).toBe(0)
    expect(result.summariesForgotten).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('reconcileOrphanedVectors: by the name match key', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation((url: string) => Promise.resolve(url === TENANT_SCOPES_URL ? scopesResponse([]) : summaryResponse([])))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('spares a chunk without an id whose name differs from a live document only by case or surrounding whitespace', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'Grundriss EG.pdf', authoredBy: 'user' }])
    fetchMock.mockResolvedValueOnce(listResponse([' grundriss eg.PDF', 'Grundriss%20EG.PDF', 'ghost.pdf']))
    fetchMock.mockResolvedValueOnce(deleteResponse(1))

    const result = await reconcileOrphanedVectors()

    expect(result.orphansFound).toBe(1)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ file_ids: ['ghost.pdf'] })
  })
})

describe('reconcileOrphanedVectors: scopes the backend holds but no document row names', () => {
  const deletes = () => fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE')

  function backend(scopes: string[], stored: Record<string, Array<{ file_name: string; document_id?: string }>>) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === TENANT_SCOPES_URL) return Promise.resolve(scopesResponse(scopes))
      if (init?.method === 'DELETE') return Promise.resolve(deleteResponse(4))
      const listed = Object.entries(stored).find(([scope]) => url.endsWith(`/v1/collections/${scope}/documents`))
      if (listed) return Promise.resolve({ ok: true, json: () => Promise.resolve(listed[1]) })
      return Promise.resolve(summaryResponse([]))
    })
  }

  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_TOKEN', 'real-secret')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('purges every chunk of a scope that holds chunks and no document row, asking with the internal token', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' }])
    backend(['proj_a', 's_geloescht'], {
      proj_a: [{ file_name: 'a.pdf' }],
      s_geloescht: [{ file_name: 'Notiz.pdf' }, { file_name: 'Plan.pdf', document_id: 'doc-weg' }],
    })

    const result = await reconcileOrphanedVectors()

    expect(result.scopesWithoutDocuments).toBe(1)
    expect(result.orphansFound).toBe(2)
    expect(result.failures).toEqual([])
    expect(deletes().map((call) => [call[0], JSON.parse((call[1] as RequestInit).body as string)])).toEqual([
      ['http://backend:8000/v1/collections/s_geloescht/documents', { file_ids: ['Plan.pdf'], documents: [{ id: 'doc-weg', file_name: 'Plan.pdf' }] }],
      ['http://backend:8000/v1/collections/s_geloescht/documents', { file_ids: ['Notiz.pdf'] }],
    ])
    const listing = fetchMock.mock.calls.find((call) => call[0] === TENANT_SCOPES_URL)
    expect((listing?.[1] as RequestInit).headers).toMatchObject({ 'x-internal-token': 'real-secret' })
  })

  it('keeps the law texts a live conversation fetched, which no document row names, and purges only its id-stamped leftovers', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' }], undefined, ['s_lebendig'])
    backend(['proj_a', 's_lebendig'], {
      proj_a: [{ file_name: 'a.pdf' }],
      s_lebendig: [{ file_name: 'RIS_Bauordnung_LBO.txt' }, { file_name: 'Anhang.pdf', document_id: 'doc-geloescht' }],
    })

    const result = await reconcileOrphanedVectors()

    expect(result.sparedInLiveConversations).toBe(1)
    expect(result.orphansFound).toBe(1)
    expect(deletes().map((call) => [call[0], JSON.parse((call[1] as RequestInit).body as string)])).toEqual([
      ['http://backend:8000/v1/collections/s_lebendig/documents', { file_ids: ['Anhang.pdf'], documents: [{ id: 'doc-geloescht', file_name: 'Anhang.pdf' }], by_id_only: true }],
    ])
  })

  it('keeps the law texts of a conversation stored under a bare id, whose scope is that id with the prefix', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' }], undefined, ['abc'])
    backend(['proj_a', 's_abc'], { proj_a: [{ file_name: 'a.pdf' }], s_abc: [{ file_name: 'RIS_Bauordnung_LBO.txt' }] })

    const result = await reconcileOrphanedVectors()

    expect(result.sparedInLiveConversations).toBe(1)
    expect(deletes()).toEqual([])
  })

  it('deletes nothing of a live conversation that holds only fetched law texts', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' }], undefined, ['s_lebendig'])
    backend(['proj_a', 's_lebendig'], { proj_a: [{ file_name: 'a.pdf' }], s_lebendig: [{ file_name: 'RIS_Bauordnung_LBO.txt' }] })

    const result = await reconcileOrphanedVectors()

    expect(result.sparedInLiveConversations).toBe(1)
    expect(deletes()).toEqual([])
  })

  it('purges an erased conversation’s scope whole, though another conversation lives', async () => {
    stubRows([{ collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' }], undefined, ['s_lebendig'])
    backend(['proj_a', 's_geloescht'], { proj_a: [{ file_name: 'a.pdf' }], s_geloescht: [{ file_name: 'RIS_Bauordnung_LBO.txt' }] })

    const result = await reconcileOrphanedVectors()

    expect(result.sparedInLiveConversations).toBe(0)
    expect(deletes().map((call) => call[0])).toEqual(['http://backend:8000/v1/collections/s_geloescht/documents'])
  })

  it('spares a scope whose re-read just before the delete finds a document row', async () => {
    stubRows(
      [{ collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' }],
      [
        { collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' },
        { collectionName: 'proj_neu', filename: 'Erstes.pdf', authoredBy: 'user' },
      ],
    )
    backend(['proj_a', 'proj_neu'], { proj_a: [{ file_name: 'a.pdf' }], proj_neu: [{ file_name: 'Erstes.pdf' }, { file_name: 'anderes.pdf' }] })

    const result = await reconcileOrphanedVectors()

    expect(result.scopesWithoutDocuments).toBe(0)
    expect(deletes()).toEqual([])
  })

  it('spares a scope whose first document row is committed between listing its chunks and the delete', async () => {
    const upload = { collectionName: 'proj_neu', filename: 'Erstes.pdf', authoredBy: 'user' }
    let listed = false
    const from = () =>
      Object.assign(Promise.resolve([{ collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' }]), {
        where: (condition: { value: string }) => Promise.resolve(listed && condition.value === 'proj_neu' ? [upload] : []),
      })
    vi.mocked(getDb).mockReturnValue(asDb({ select: () => ({ from }) }))
    backend(['proj_a', 'proj_neu'], { proj_a: [{ file_name: 'a.pdf' }], proj_neu: [{ file_name: 'Erstes.pdf' }] })
    const answer = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/collections/proj_neu/documents') && init?.method !== 'DELETE') listed = true
      return answer(url, init)
    })

    const result = await reconcileOrphanedVectors()

    expect(result.scopesWithoutDocuments).toBe(0)
    expect(deletes()).toEqual([])
  })

  it('visits no scope when the document catalog reads empty, and records a refused listing without failing the run', async () => {
    stubRows([])
    backend(['proj_a'], { proj_a: [{ file_name: 'a.pdf' }] })

    const empty = await reconcileOrphanedVectors()

    expect(empty.scopesWithoutDocuments).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()

    stubRows([{ collectionName: 'proj_a', filename: 'a.pdf', authoredBy: 'user' }])
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url === TENANT_SCOPES_URL ? { ok: false, status: 503 } : url.endsWith('/documents') ? listResponse(['a.pdf']) : summaryResponse([])),
    )
    const refused = await reconcileOrphanedVectors()

    expect(refused.failures).toEqual([{ collectionName: TENANT_SCOPES_FAILURE_NAME, error: 'tenant-scopes returned 503' }])
  })
})

describe('reconcileOrphanedVectors: the document facts half', () => {
  const documentFactsCalls = () => fetchMock.mock.calls.filter((call) => call[0] === DOCUMENT_FACTS_URL)
  const refreshed = (collections: number, files: number, failures: { collection: string; error: string }[] = []) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ status: 'ok', collections_scanned: collections, files_refreshed: files, failures }),
  })
  const live = (count: number) =>
    Array.from({ length: count }, (_, n) => ({ collectionName: `proj_${n}`, filename: 'a.pdf', authoredBy: 'user' }))

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    vi.stubEnv('INTERNAL_API_TOKEN', 'real-secret')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('copies every live collection’s document facts again, in bounded batches, with the internal token', async () => {
    stubRows(live(DOCUMENT_FACTS_BATCH + 3))
    fetchMock.mockImplementation((url: string) => {
      if (url === DOCUMENT_FACTS_URL) return Promise.resolve(refreshed(0, 0))
      if (url.endsWith('/documents')) return Promise.resolve(listResponse(['a.pdf']))
      if (url === TENANT_SCOPES_URL) return Promise.resolve(scopesResponse([]))
      return Promise.resolve(summaryResponse([]))
    })

    await reconcileOrphanedVectors()

    const calls = documentFactsCalls()
    expect(calls.map((call) => JSON.parse(call[1].body).collections.length)).toEqual([DOCUMENT_FACTS_BATCH, 3])
    expect(calls.flatMap((call) => JSON.parse(call[1].body).collections)).toEqual(live(DOCUMENT_FACTS_BATCH + 3).map((row) => row.collectionName))
    expect(calls[0][1].headers['x-internal-token']).toBe('real-secret')
    expect(calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('reports what it copied, and a collection the backend could not copy under its name', async () => {
    stubRows(live(2))
    fetchMock.mockImplementation((url: string) => {
      if (url === DOCUMENT_FACTS_URL) return Promise.resolve(refreshed(2, 7, [{ collection: 'proj_1', error: 'timed out' }]))
      if (url.endsWith('/documents')) return Promise.resolve(listResponse(['a.pdf']))
      if (url === TENANT_SCOPES_URL) return Promise.resolve(scopesResponse([]))
      return Promise.resolve(summaryResponse([]))
    })

    const result = await reconcileOrphanedVectors()

    expect(result.documentFacts).toEqual({ collections: 2, files: 7, unsupported: false })
    expect(result.failures).toEqual([{ collectionName: 'proj_1', error: 'document facts: timed out' }])
  })

  it('records a refused batch under each of its collections, runs the next, and stops on a deployment without Qdrant', async () => {
    stubRows(live(DOCUMENT_FACTS_BATCH + 1))
    const answers = [{ ok: false, status: 503 }, refreshed(1, 2)]
    fetchMock.mockImplementation((url: string) => {
      if (url === DOCUMENT_FACTS_URL) return Promise.resolve(answers.shift())
      if (url.endsWith('/documents')) return Promise.resolve(listResponse(['a.pdf']))
      if (url === TENANT_SCOPES_URL) return Promise.resolve(scopesResponse([]))
      return Promise.resolve(summaryResponse([]))
    })

    const result = await reconcileOrphanedVectors()

    expect(result.documentFacts).toEqual({ collections: 1, files: 2, unsupported: false })
    expect(result.failures).toHaveLength(DOCUMENT_FACTS_BATCH)
    expect(result.failures[0]).toEqual({ collectionName: 'proj_0', error: 'document facts: refresh-document-facts returned 503' })

    fetchMock.mockClear()
    fetchMock.mockImplementation((url: string) => {
      if (url === DOCUMENT_FACTS_URL) return Promise.resolve({ ok: false, status: 409 })
      if (url.endsWith('/documents')) return Promise.resolve(listResponse(['a.pdf']))
      if (url === TENANT_SCOPES_URL) return Promise.resolve(scopesResponse([]))
      return Promise.resolve(summaryResponse([]))
    })
    const without = await reconcileOrphanedVectors()
    expect(without.documentFacts).toEqual({ collections: 0, files: 0, unsupported: true })
    expect(without.failures).toEqual([])
    expect(documentFactsCalls()).toHaveLength(1)
  })
})

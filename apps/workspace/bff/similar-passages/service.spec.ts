/**
 * @vitest-environment node
 *
 * „Im Büro behandelt" with the stores and the backend mocked: what one search
 * may name (the backend's collection cap, the reader's own project first).
 * Who may see what is proven against a real Postgres in
 * `service.integration.spec.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Project } from '@/lib/db/schema/projects'
import { makeProject } from '@/test-utils/db-fixtures'


const state = vi.hoisted(() => ({
  reach: [] as Project[],
  cleared: new Map<string, string[]>(),
  asked: [] as string[][],
  signed: [] as Array<{ collectionScope?: unknown[]; organizationId?: string }>,
}))

vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@/lib/request-context', () => ({
  buildRequestContextWireHeaders: (input: { collectionScope?: unknown[]; organizationId?: string }) => {
    state.signed.push(input)
    return {}
  },
}))
vi.mock('@/lib/base-knowledge/context/corpus-countries', () => ({
  corpusCountriesFor: vi.fn(async (organizationId: string) => (organizationId === 'org_1' ? ['QA'] : [])),
}))
vi.mock('@/lib/documents/access', () => ({
  getAccessibleDocument: vi.fn(async (_session: unknown, id: string) => ({
    id,
    collectionName: 'proj_1',
    filename: 'quelle.pdf',
    projectId: 'p1',
    status: 'completed',
    screeningOutcome: 'clean',
  })),
}))
vi.mock('@/lib/projects/service', () => ({ listChatProjects: vi.fn(async () => state.reach) }))
vi.mock('@/lib/office-shelf/repository', () => ({ findOfficeShelfDocumentsByFilenames: vi.fn(async () => []) }))
vi.mock('@/lib/documents/repository', () => ({ findDocumentsByIds: vi.fn(async () => []) }))
vi.mock('@/lib/documents/shelf-listing', () => ({ toListedDocuments: vi.fn(async () => []) }))
vi.mock('@/lib/documents/semantic-search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/documents/semantic-search')>()
  return {
    BACKEND_SEARCH_MAX_COLLECTIONS: actual.BACKEND_SEARCH_MAX_COLLECTIONS,
    projectsWithinCollectionCap: actual.projectsWithinCollectionCap,
    joinHitsToFiles: actual.joinHitsToFiles,
    findHitDocuments: actual.findHitDocuments,
    planProjectSearch: vi.fn(async (_session: unknown, projectId: string) => {
      const project = state.reach.find((one) => one.id === projectId)
      if (!project) throw new Error('not found')
      return {
        project,
        access: { hiddenFolderIds: new Set() },
        collections: [project.collectionName, ...(state.cleared.get(projectId) ?? [])],
      }
    }),
    hydrateProjectHits: vi.fn(async () => []),
  }
})

import { ServiceUnavailableError } from '@/lib/api/errors'
import { findOfficeShelfDocumentsByFilenames } from '@/lib/office-shelf/repository'
import { findDocumentsByIds } from '@/lib/documents/repository'
import { toListedDocuments } from '@/lib/documents/shelf-listing'
import type { ListedDocument } from '@/lib/documents/shelf-listing'
import { BACKEND_SEARCH_MAX_COLLECTIONS, hydrateProjectHits } from '@/lib/documents/semantic-search'
import { findSimilarPassages, foldDocuments } from './service'

const session = { userId: 'u1', organizationId: 'org_1', role: 'member', permissions: [] } as unknown as AuthorizedSession
const request = {
  document: { kind: 'stored' as const, documentId: 'd-source' },
  passage: { text: 'Brandabschnitt im Dachgeschoss', cited: true },
}
const restricted = (project: Project, count: number) =>
  Array.from({ length: count }, (_, n) => `${project.collectionName}_r${String(n).padStart(12, '0')}`)

beforeEach(() => {
  vi.clearAllMocks()
  state.reach = Array.from({ length: 30 }, (_, index) =>
    makeProject({ id: `p${index + 1}`, collectionName: `proj_${index + 1}`, name: `Projekt ${index + 1}` })
  )
  state.cleared = new Map()
  state.asked = []
  state.signed = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      state.asked.push((JSON.parse(String(init.body)) as { collections: string[] }).collections)
      return new Response(JSON.stringify({ documents: [], origin: 'point' }), { status: 200 })
    })
  )
})

describe('the backend’s collection cap', () => {
  it('stops adding projects before the collections pass it, the reader’s own project and the Bürobibliothek kept', async () => {
    for (const project of state.reach) state.cleared.set(project.id, restricted(project, 39))

    const response = await findSimilarPassages(session, request)

    const [collections] = state.asked
    expect(BACKEND_SEARCH_MAX_COLLECTIONS).toBe(500)
    expect(collections.length).toBeLessThanOrEqual(BACKEND_SEARCH_MAX_COLLECTIONS)
    expect(collections.slice(0, 40)).toEqual(['proj_1', ...restricted(state.reach[0], 39)])
    expect(collections).toContain('archiv_org_1')
    expect(response.projectsSearched).toBe(11)
  })

  it('cuts the reader’s own project to the cap when it alone passes it, and still asks the Bürobibliothek', async () => {
    state.cleared.set('p1', restricted(state.reach[0], BACKEND_SEARCH_MAX_COLLECTIONS + 5))

    const response = await findSimilarPassages(session, request)

    const [collections] = state.asked
    expect(collections).toHaveLength(BACKEND_SEARCH_MAX_COLLECTIONS)
    expect(collections[0]).toBe('proj_1')
    expect(collections).toContain('archiv_org_1')
    expect(response.projectsSearched).toBe(0)
  })
})

describe('the base corpus in the signed scope', () => {
  const legal = { ...request, document: { kind: 'base' as const, fileName: 'oib-rl_2_ausgabe_mai_2023.pdf' } }
  const baseEntry = () =>
    (state.signed[0].collectionScope ?? []).find(
      (entry) => typeof entry === 'object' && (entry as { shelf?: string }).shelf === 'base',
    )

  it('signs the base entry with the office’s entitled countries, so a base source is found for them', async () => {
    await findSimilarPassages(session, legal)

    expect(baseEntry()).toEqual({ collection: 'base_corpus', shelf: 'base', countries: ['QA'] })
  })

  it('signs an empty country list for an office entitled to none, so another country’s base text is not read', async () => {
    await findSimilarPassages({ ...session, organizationId: 'org_2' } as AuthorizedSession, legal)

    expect(baseEntry()).toEqual({ collection: 'base_corpus', shelf: 'base', countries: [] })
  })
})

describe('projectId', () => {
  it('names the current project without narrowing the search, and the operation says so', async () => {
    state.reach = state.reach.slice(0, 9)
    const legal = { ...request, document: { kind: 'base' as const, fileName: 'oib-rl_2_ausgabe_mai_2023.pdf' } }

    const without = await findSimilarPassages(session, legal)
    const within = await findSimilarPassages(session, { ...legal, projectId: 'p3' })

    expect(state.asked[0].slice().sort()).toEqual(state.asked[1].slice().sort())
    expect(state.asked[1][0]).toBe('proj_3')
    expect([without.projectsSearched, within.projectsSearched]).toEqual([9, 8])

    const operation = (await import('@/lib/agent-api/catalog')).findOperation('passage-similar-search')
    expect(operation?.description).toMatch(/`projectId` does not narrow the search/)
    expect(operation?.description).toMatch(/`projectsSearched` counts the projects besides that one/)
  })
})

describe('a failed join to the documents', () => {
  const answering = (collection: string, fileName: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              documents: [{ collection, file_name: fileName, passages: [{ chunk_id: 'c1', snippet: 'Treppe', page_number: 1, score: 0.9 }] }],
              origin: 'point',
            }),
            { status: 200 }
          )
      )
    )

  it('is the error state for a project’s hits, never "not dealt with in the office"', async () => {
    answering('proj_2', 'treppe.pdf')
    vi.mocked(hydrateProjectHits).mockRejectedValueOnce(new Error('connection terminated'))

    await expect(findSimilarPassages(session, request)).rejects.toBeInstanceOf(ServiceUnavailableError)
  })

  it('is the error state for the Bürobibliothek’s hits too', async () => {
    answering('archiv_org_1', 'musterdetail.pdf')
    vi.mocked(findOfficeShelfDocumentsByFilenames).mockRejectedValueOnce(new Error('connection terminated'))

    await expect(findSimilarPassages(session, request)).rejects.toBeInstanceOf(ServiceUnavailableError)
  })
})

describe('a Bürobibliothek hit that names its document by id', () => {
  const DRAFT_ID = '4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f'
  const SUBMISSION_ID = '5a0d2e3f-4c5b-4d6e-9f70-8b9cad1e2f30'
  const listed = (id: string) =>
    ({ id, filename: 'Musterdetail.pdf', collectionName: 'archiv_org_1', authoredBy: 'user', displayName: null, contentType: 'application/pdf', revisionFacts: null, revision: null }) as unknown as ListedDocument

  it('joins the passages to the document the id names, not to a same-named one in another folder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              documents: [
                {
                  collection: 'archiv_org_1',
                  file_name: 'Musterdetail.pdf',
                  document_id: SUBMISSION_ID,
                  passages: [{ chunk_id: 'c1', snippet: 'Attika', page_number: 2, score: 0.9 }],
                },
              ],
              origin: 'point',
            }),
            { status: 200 }
          )
      )
    )
    vi.mocked(findDocumentsByIds).mockImplementation(async (_shelf, _organizationId, ids) => ids.map((id) => ({ id }) as never))
    vi.mocked(toListedDocuments).mockImplementation(async (_session, rows) => rows.map((row) => listed(row.id)))

    const response = await findSimilarPassages(session, request)

    expect(findDocumentsByIds).toHaveBeenCalledWith({ kind: 'office_shelf' }, 'org_1', [SUBMISSION_ID], { reader: { kind: 'screened-only' } })
    expect(findOfficeShelfDocumentsByFilenames).not.toHaveBeenCalled()
    expect(JSON.stringify(response)).toContain(SUBMISSION_ID)
    expect(JSON.stringify(response)).not.toContain(DRAFT_ID)
  })
})

describe('foldDocuments', () => {
  const row = (id: string, extra: Record<string, unknown> = {}) =>
    ({
      id,
      filename: `${id}.pdf`,
      displayName: null,
      contentType: 'application/pdf',
      revisionFacts: null,
      revision: null,
      page: 2,
      snippet: `Auszug aus ${id}`,
      score: 0.8,
      rank: 0,
      ...extra,
    }) as unknown as Parameters<typeof foldDocuments>[0][number]

  it('leaves out a Fassung a person confirmed a newer one replaces, as knowledge_search does: the vector copy can lag', () => {
    const folded = foldDocuments(
      [row('aktuell'), row('alt', { revision: { supersededBy: { id: 'aktuell', filename: 'aktuell.pdf' } } })],
      null
    )

    expect(folded.map((entry) => entry.document.documentId)).toEqual(['aktuell'])
  })
})

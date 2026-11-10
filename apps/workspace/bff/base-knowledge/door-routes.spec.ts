/**
 * @vitest-environment node
 *
 * The door's hold on a licensed copy, through the routes an agent actually calls
 * (`callOperation(..., 'agent')`), not the guard alone: a route that lost its
 * guard fails here. The services behind each route return the norm whole; only the
 * licence lookup, the access check and the shared counter are stand-ins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const NORM = 'Tabelle 3 – Mindesthöhe 100 cm bis 12 m Absturzhöhe. '.repeat(40)

const licence = vi.hoisted(() => ({ value: null as unknown, fails: false }))
vi.mock('@/lib/base-knowledge/text-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/base-knowledge/text-guard')>()),
  licenceOfDocument: vi.fn(async () => {
    if (licence.fails) throw new Error('records unreadable')
    return licence.value
  }),
}))
vi.mock('@/lib/documents/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/access')>()),
  getAccessibleDocument: vi.fn(async () => ({})),
}))
const counters = vi.hoisted(() => new Map<string, number>())
vi.mock('@/lib/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cache')>()),
  incrementCounter: async (key: string, by: number) => {
    counters.set(key, (counters.get(key) ?? 0) + by)
    return counters.get(key)
  },
}))
vi.mock('@/lib/documents/document-delivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/document-delivery')>()),
  getDocumentTextPreview: vi.fn(async () => ({ text: NORM, truncated: false, contentType: 'text/markdown', filename: 'n.md' })),
  streamDocumentFile: vi.fn(async () => new Response(NORM)),
  getDocumentPreview: vi.fn(async () => ({ url: 'https://store/norm.pdf' })),
  getDocumentThumbnail: vi.fn(async () => new Response('png')),
  getDocumentDownload: vi.fn(async () => ({ url: 'https://store/norm.pdf' })),
}))
vi.mock('@/lib/documents/version-content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/version-content')>()),
  readVersionContent: vi.fn(async () => NORM),
  streamVersionFile: vi.fn(async () => new Response(NORM)),
}))
vi.mock('@/lib/documents/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/lifecycle')>()),
  getDocumentVersionView: vi.fn(async () => ({ id: 'v' })),
}))
vi.mock('@/lib/search/document-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/search/document-search')>()),
  runTimedSearch: vi.fn(async () => ({
    response: { sections: { document: { hits: [{ kind: 'document', id: 'doc1', passage: { text: NORM.slice(0, 300), page: 4 } }] } } },
    timing: {},
  })),
  serverTimingHeader: () => 'total;dur=1',
}))
vi.mock('@/lib/similar-passages/service', () => ({
  findSimilarPassages: vi.fn(async () => ({
    groups: [{ kind: 'office_shelf', project: null, documents: [{ documentId: 'doc1', passages: [{ page: 4, snippet: NORM.slice(0, 300), score: 0.9 }] }] }],
    projectsSearched: 0,
    origin: 'embedded',
  })),
}))

import { findOperation } from '@/lib/agent-api/catalog'
import { callOperation, type OperationInput } from '@/lib/agent-api/dispatch'
import { DOOR_QUOTE_FACTOR, LICENSED_SNIPPET_NOTE } from './door-guard'

const session = {
  userId: 'user-1',
  email: 'test@example.com',
  name: null,
  accessToken: '',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'member' as const,
  permissions: [],
  featureFlags: null,
}
const attested = {
  licenceClass: 'licensed',
  licensed: true,
  confirmed: true,
  aiProcessingAttested: true,
  quoteMaxChars: 100,
  editionId: 'ed_1',
}

function call(name: string, input: OperationInput, reader: 'agent' | 'person' = 'agent') {
  const op = findOperation(name)
  if (!op) throw new Error(`${name} is not in the catalog`)
  return callOperation(op, input, session, reader)
}

const DOC = { params: { id: 'doc1' } }
/** The routes that hand out a licensed copy whole: its file, its links, its versions. */
const WHOLE: Array<[string, OperationInput]> = [
  ['document-file-get', DOC],
  ['document-download', DOC],
  ['document-preview-get', DOC],
  ['document-thumbnail-get', DOC],
  ['document-version-content-get', { params: { id: 'doc1', versionId: 'v1' } }],
  ['document-version-diff', { params: { id: 'doc1' }, query: { from: 'v1', to: 'v2' } }],
]

beforeEach(() => {
  licence.value = attested
  licence.fails = false
  counters.clear()
})

describe('an agent at the door, through the routes', () => {
  it.each(WHOLE)('gets no %s of a licensed copy', async (name, input) => {
    const result = await call(name, input)
    expect(result.status).toBe(403)
    expect(JSON.stringify(result.body)).toContain('LICENSED_COPY_NOT_SENT')
  })

  it('reads document-text-get within the budget, then is refused', async () => {
    const first = await call('document-text-get', DOC)
    expect(first.status).toBe(200)
    expect((first.body as { text: string }).text).toHaveLength(DOOR_QUOTE_FACTOR * 100)
    expect(JSON.stringify((await call('document-text-get', DOC)).body)).toContain('LICENSED_QUOTE_CAP_REACHED')
  })

  it('gets the note for a licensed copy’s snippet from workspace-search and passage-similar-search', async () => {
    const searched = await call('workspace-search', { body: { text: 'Mindesthöhe' } })
    expect(JSON.stringify(searched.body)).toContain(LICENSED_SNIPPET_NOTE)
    expect(JSON.stringify(searched.body)).not.toContain('Absturzhöhe')
    const similar = await call('passage-similar-search', {
      body: { document: { kind: 'stored', documentId: 'doc2' }, passage: { text: NORM.slice(0, 120), cited: false } },
    })
    expect(JSON.stringify(similar.body)).toContain(LICENSED_SNIPPET_NOTE)
  })

  it('is refused every licensed route when the copy’s licence cannot be read (fail closed)', async () => {
    licence.fails = true
    for (const [name, input] of [...WHOLE, ['document-text-get', DOC] as [string, OperationInput]]) {
      expect(JSON.stringify((await call(name, input)).body), name).toContain('LICENSED_COPY_UNKNOWN')
    }
  })
})

describe('the person, through the same routes', () => {
  it('reads the licensed copy whole and gets its file and snippets', async () => {
    const text = await call('document-text-get', DOC, 'person')
    expect((text.body as { text: string }).text).toBe(NORM)
    expect((await call('document-file-get', DOC, 'person')).status).toBe(200)
    expect(JSON.stringify((await call('workspace-search', { body: { text: 'Mindesthöhe' } }, 'person')).body)).toContain('Absturzhöhe')
  })
})

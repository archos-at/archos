/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn(),
}))

vi.mock('@/lib/documents/document-storage-keys', () => ({
  findDocumentStorageKey: vi.fn(),
  findDocumentStorageKeyById: vi.fn(),
  findDocumentImageStorageKey: vi.fn(),
  findDocumentImageStorageKeyById: vi.fn(),
}))

vi.mock('@/lib/drawing-calibrations/page-read', () => ({ activeCalibrationsOfPage: vi.fn() }))
vi.mock('@/lib/conversations/personal-shelf-use', () => ({ admitPersonalShelf: vi.fn(async () => []) }))

vi.mock('@/lib/conversations/restricted-use', () => ({
  drawableRestrictedCollections: vi.fn(),
}))

vi.mock('@/lib/db/tenant-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/tenant-context')>()),
  withTenant: vi.fn(async (_scope: unknown, run: () => Promise<unknown>) => run()),
}))

import { GET } from './route'
import { drawableRestrictedCollections } from '@/lib/conversations/restricted-use'
import { admitPersonalShelf } from '@/lib/conversations/personal-shelf-use'
import { withTenant } from '@/lib/db/tenant-context'
import { activeCalibrationsOfPage } from '@/lib/drawing-calibrations/page-read'
import { ConflictError } from '@/lib/api/errors'
import {
  findDocumentImageStorageKey,
  findDocumentImageStorageKeyById,
  findDocumentStorageKey,
  findDocumentStorageKeyById,
} from '@/lib/documents/document-storage-keys'
import { REQUEST_CONTEXT_HEADER_NAMES, buildRequestContextEnvelope } from '@/lib/request-context'
import { closedContext } from '@/lib/conversation-context/context.fixtures'
import { TURN_DECISION_HEADER, TURN_DECISION_SIGNATURE_HEADER, decisionOf, signDecision } from '@/lib/conversation-context/wire'

const request = (
  query = '?collection=proj_1&filename=plan.png',
  token: string | null = 'test-token',
  headers: Record<string, string> = {}
): Request =>
  new Request(`http://localhost/api/internal/document-file${query}`, {
    headers: { ...(token ? { 'x-grid-internal-token': token } : {}), ...headers },
  })

const RESTRICTED = 'proj_1_r0123456789ab'
const WRONG_SECRET = 'not-the-signing-secret' // pragma: allowlist secret

function envelope(
  overrides: { collectionScope?: string[]; conversationId?: string | null; secret?: string } = {}
): Record<string, string> {
  const { header, signature } = buildRequestContextEnvelope(
    {
      organizationId: 'org_1',
      userId: 'user_asker',
      projectId: 'p1',
      collectionScope: overrides.collectionScope ?? ['base_corpus', 'proj_1'],
      ...(overrides.conversationId === null ? {} : { conversationId: overrides.conversationId ?? 's_conv_1' }),
      issuedAt: Date.now(),
    },
    overrides.secret ?? 'test-token'
  )
  return {
    [REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT]: header,
    [REQUEST_CONTEXT_HEADER_NAMES.REQUEST_CONTEXT_SIG]: signature ?? '',
  }
}

function decided(
  shelves: string[],
  {
    restricted = [],
    conversationId = 's_conv_1',
    userId = 'user_asker',
    kind = 'chat',
  }: { restricted?: string[]; conversationId?: string; userId?: string; kind?: 'chat' | 'headless' } = {}
): Record<string, string> {
  const closed = closedContext(kind, conversationId)
  const may = { ...closed.may, shelves: shelves.map((collection) => ({ collection, shelf: 'project' as const })), restrictedCollections: restricted }
  const { header, signature } = signDecision(decisionOf({ ...closed, may }, { organizationId: 'org_1', userId }, null, Date.now()), 'test-token')
  return { [TURN_DECISION_HEADER]: header, [TURN_DECISION_SIGNATURE_HEADER]: signature }
}

const STORED = { id: '11111111-1111-4111-8111-111111111111', storageKey: 'org/o1/project/p1/doc/d1/plan.png', storageBucket: null, contentType: 'image/png', versionId: null }

describe('GET /api/internal/document-file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-token')
    vi.stubEnv('APP_ENV', 'development')
  })

  it('rejects when the token is missing or wrong', async () => {
    expect((await GET(request('?collection=proj_1&filename=plan.png', null))).status).toBe(403)
    expect((await GET(request('?collection=proj_1&filename=plan.png', 'wrong'))).status).toBe(403)
    expect(findDocumentStorageKey).not.toHaveBeenCalled()
  })

  it('fails closed when the token is unconfigured', async () => {
    vi.stubEnv('INTERNAL_API_TOKEN', undefined)
    expect((await GET(request())).status).toBe(503)
  })

  it('400s when the collection is missing/empty, or neither a document id nor a filename names the document', async () => {
    expect((await GET(request('?filename=plan.png'))).status).toBe(400)
    expect((await GET(request('?collection=proj_1'))).status).toBe(400)
    expect((await GET(request('?collection=&filename=plan.png'))).status).toBe(400)
    expect((await GET(request(`?documentId=${STORED.id}`))).status).toBe(400)
    expect(findDocumentStorageKey).not.toHaveBeenCalled()
    expect(findDocumentStorageKeyById).not.toHaveBeenCalled()
  })

  describe('by document id', () => {
    const DRAFT = { ...STORED, id: '33333333-3333-4333-8333-333333333333', storageKey: 'org/o1/project/p1/doc/entwurf/Plan.pdf' }
    const SUBMISSION = { ...STORED, id: '44444444-4444-4444-8444-444444444444', storageKey: 'org/o1/project/p1/doc/einreichung/Plan.pdf' }

    it('answers the key of the document the id names, of two same-named ones in different folders', async () => {
      vi.mocked(findDocumentStorageKeyById).mockImplementation(async (_collection, id) =>
        [DRAFT, SUBMISSION].find((row) => row.id === id) ?? null
      )

      const draft = await GET(request(`?collection=proj_1&documentId=${DRAFT.id}`))
      const submission = await GET(request(`?collection=proj_1&documentId=${SUBMISSION.id}`))

      expect(await draft.json()).toMatchObject({ documentId: DRAFT.id, storageKey: 'org/o1/project/p1/doc/entwurf/Plan.pdf' })
      expect(await submission.json()).toMatchObject({ documentId: SUBMISSION.id, storageKey: 'org/o1/project/p1/doc/einreichung/Plan.pdf' })
      expect(vi.mocked(findDocumentStorageKeyById).mock.calls[0]).toEqual(['proj_1', DRAFT.id, undefined])
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
    })

    it('prefers the id when the caller also sends the name', async () => {
      vi.mocked(findDocumentStorageKeyById).mockResolvedValue(DRAFT)
      const res = await GET(request(`?collection=proj_1&documentId=${DRAFT.id}&filename=Plan.pdf&organizationId=org_1`))
      expect(res.status).toBe(200)
      expect(vi.mocked(findDocumentStorageKeyById).mock.calls[0]).toEqual(['proj_1', DRAFT.id, 'org_1'])
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
    })

    it('400s an id that is not one, rather than falling back to the name', async () => {
      expect((await GET(request('?collection=proj_1&documentId=Plan.pdf&filename=Plan.pdf'))).status).toBe(400)
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
      expect(findDocumentStorageKeyById).not.toHaveBeenCalled()
    })

    it('404s an id with no readable row in that collection', async () => {
      vi.mocked(findDocumentStorageKeyById).mockResolvedValue(null)
      expect((await GET(request(`?collection=proj_1&documentId=${DRAFT.id}`))).status).toBe(404)
    })

    it('resolves a stored raster by the id', async () => {
      vi.mocked(findDocumentImageStorageKeyById).mockResolvedValue({
        storageKey: 'org/o1/project/p1/doc/entwurf/_img/1.jpg',
        storageBucket: null,
        contentType: 'image/jpeg',
      })
      const res = await GET(request(`?collection=proj_1&documentId=${DRAFT.id}&imageIndex=1`))
      expect(await res.json()).toMatchObject({ storageKey: 'org/o1/project/p1/doc/entwurf/_img/1.jpg' })
      expect(vi.mocked(findDocumentImageStorageKeyById).mock.calls[0]).toEqual(['proj_1', DRAFT.id, 1, undefined])
      expect(findDocumentImageStorageKey).not.toHaveBeenCalled()
    })
  })

  it('answers 409 ambiguous_name when the name alone names more than one document, instead of the newest', async () => {
    vi.mocked(findDocumentStorageKey).mockRejectedValue(
      new ConflictError('More than one document in this collection has this name', { reason: 'ambiguous_name' })
    )
    const res = await GET(request('?collection=proj_1&filename=Plan.pdf'))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'CONFLICT', details: { reason: 'ambiguous_name' } })
  })

  it('404s when the document index has no row for the pair', async () => {
    vi.mocked(findDocumentStorageKey).mockResolvedValue(null)
    const res = await GET(request())
    expect(res.status).toBe(404)
    expect(vi.mocked(findDocumentStorageKey).mock.calls[0]).toEqual(['proj_1', 'plan.png', undefined])
  })

  it('forwards organizationId to the service when the query param is present', async () => {
    vi.mocked(findDocumentStorageKey).mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      storageKey: 'org/o1/archiv/doc/d1/plan.png',
      storageBucket: null,
      contentType: 'image/png',
      versionId: null,
    })
    const res = await GET(request('?collection=archiv_org_1&filename=plan.png&organizationId=org_1'))
    expect(res.status).toBe(200)
    expect(vi.mocked(findDocumentStorageKey).mock.calls[0]).toEqual(['archiv_org_1', 'plan.png', 'org_1'])
  })

  it('passes no organizationId to the service when the query param is absent', async () => {
    vi.mocked(findDocumentStorageKey).mockResolvedValue(null)
    await GET(request())
    expect(vi.mocked(findDocumentStorageKey).mock.calls[0][2]).toBeUndefined()
  })

  it('returns the document id, the storage key, its bucket and the content type for a known document', async () => {
    vi.mocked(findDocumentStorageKey).mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      storageKey: 'org/o1/project/p1/doc/d1/plan.png',
      storageBucket: null,
      contentType: 'image/png',
      versionId: '22222222-2222-4222-8222-222222222222',
    })
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      documentId: '11111111-1111-4111-8111-111111111111',
      storageKey: 'org/o1/project/p1/doc/d1/plan.png',
      storageBucket: null,
      contentType: 'image/png',
      versionId: '22222222-2222-4222-8222-222222222222',
    })
  })

  it('passes a per-organization bucket through to the caller', async () => {
    vi.mocked(findDocumentStorageKey).mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      storageKey: 'org/o1/project/p1/doc/d1/plan.png',
      storageBucket: 'grid-org-o1-abcdef123456',
      contentType: 'image/png',
      versionId: null,
    })
    const res = await GET(request())
    expect(await res.json()).toMatchObject({ storageBucket: 'grid-org-o1-abcdef123456' })
  })

  describe('with imageIndex', () => {
    it('resolves the stored raster through the image lookup, not the file lookup', async () => {
      vi.mocked(findDocumentImageStorageKey).mockResolvedValue({
        storageKey: 'org/o1/project/p1/doc/d1/_img/2.jpg',
        storageBucket: null,
        contentType: 'image/jpeg',
      })
      const res = await GET(request('?collection=proj_1&filename=plan.pdf&imageIndex=2'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        storageKey: 'org/o1/project/p1/doc/d1/_img/2.jpg',
        storageBucket: null,
        contentType: 'image/jpeg',
      })
      expect(vi.mocked(findDocumentImageStorageKey).mock.calls[0]).toEqual(['proj_1', 'plan.pdf', 2, undefined])
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
    })

    it('404s when the document or the index is unknown', async () => {
      vi.mocked(findDocumentImageStorageKey).mockResolvedValue(null)
      expect((await GET(request('?collection=proj_1&filename=plan.pdf&imageIndex=99'))).status).toBe(404)
    })

    it('400s a negative or non-integer index before any lookup', async () => {
      expect((await GET(request('?collection=proj_1&filename=plan.pdf&imageIndex=-1'))).status).toBe(400)
      expect((await GET(request('?collection=proj_1&filename=plan.pdf&imageIndex=1.5'))).status).toBe(400)
      expect((await GET(request('?collection=proj_1&filename=plan.pdf&imageIndex=abc'))).status).toBe(400)
      expect(findDocumentImageStorageKey).not.toHaveBeenCalled()
    })
  })

  describe("with the turn's signed envelope", () => {
    beforeEach(() => {
      vi.mocked(findDocumentStorageKey).mockResolvedValue(STORED)
      vi.mocked(drawableRestrictedCollections).mockResolvedValue([])
    })

    it('answers for a collection the envelope signs, in the organization it names', async () => {
      const res = await GET(request('?collection=proj_1&filename=plan.png', 'test-token', envelope()))
      expect(res.status).toBe(200)
      expect(vi.mocked(withTenant).mock.calls[0][0]).toEqual({ organizationId: 'org_1', userId: 'user_asker' })
      expect(vi.mocked(findDocumentStorageKey).mock.calls[0]).toEqual(['proj_1', 'plan.png', 'org_1'])
    })

    it('404s a collection outside the signed scope, before any lookup', async () => {
      const res = await GET(request('?collection=proj_other&filename=plan.png', 'test-token', envelope()))
      expect(res.status).toBe(404)
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
    })

    it('404s a query naming another organization than the envelope', async () => {
      const res = await GET(
        request('?collection=proj_1&filename=plan.png&organizationId=org_2', 'test-token', envelope())
      )
      expect(res.status).toBe(404)
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
    })

    it('401s an envelope that does not verify, rather than falling back to the name', async () => {
      const res = await GET(
        request('?collection=proj_1&filename=plan.png', 'test-token', envelope({ secret: WRONG_SECRET }))
      )
      expect(res.status).toBe(401)
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
    })

    it('answers for a restricted folder the asker and the audience may read now', async () => {
      vi.mocked(drawableRestrictedCollections).mockResolvedValue([RESTRICTED])
      const headers = envelope({ collectionScope: ['proj_1', RESTRICTED] })
      const res = await GET(request(`?collection=${RESTRICTED}&filename=gehalt.png`, 'test-token', headers))
      expect(res.status).toBe(200)
      expect(vi.mocked(drawableRestrictedCollections).mock.calls[0]).toEqual([
        { organizationId: 'org_1', conversationId: 's_conv_1', userId: 'user_asker', projectId: 'p1' },
        [RESTRICTED],
      ])
    })

    it('404s a restricted folder the asker lost read on, though the scope still signs it', async () => {
      vi.mocked(drawableRestrictedCollections).mockResolvedValue([])
      const headers = envelope({ collectionScope: ['proj_1', RESTRICTED] })
      const query = `?collection=${RESTRICTED}&filename=gehalt.png&imageIndex=0`
      const res = await GET(request(query, 'test-token', headers))
      expect(res.status).toBe(404)
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
      expect(findDocumentImageStorageKey).not.toHaveBeenCalled()
    })

    it('404s a restricted folder in an envelope with no conversation to admit it in', async () => {
      const headers = envelope({ collectionScope: ['proj_1', RESTRICTED], conversationId: null })
      const res = await GET(request(`?collection=${RESTRICTED}&filename=gehalt.png`, 'test-token', headers))
      expect(res.status).toBe(404)
      expect(drawableRestrictedCollections).not.toHaveBeenCalled()
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
    })
  })

  describe('without an envelope', () => {
    it('never answers for a restricted folder, in either spelling', async () => {
      vi.mocked(findDocumentStorageKey).mockResolvedValue(STORED)
      expect((await GET(request(`?collection=${RESTRICTED}&filename=gehalt.png`))).status).toBe(404)
      expect((await GET(request(`?collection=${RESTRICTED.toUpperCase()}&filename=gehalt.png`))).status).toBe(404)
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
      expect(drawableRestrictedCollections).not.toHaveBeenCalled()
    })

    it('never answers for a person’s own shelf, which only its owner’s signed envelope reaches (ADR-0193)', async () => {
      vi.mocked(findDocumentStorageKey).mockResolvedValue(STORED)
      expect((await GET(request('?collection=personal_org_1__user_asker&filename=plan.png&organizationId=org_1'))).status).toBe(404)
      expect((await GET(request('?collection=PERSONAL_org_1__user_asker&filename=plan.png'))).status).toBe(404)
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
    })

    it('serves the owner’s own shelf only once its live admission under the turn’s decision holds (ADR-0193)', async () => {
      vi.mocked(findDocumentStorageKey).mockResolvedValue(STORED)
      const own = 'personal_org_1__user_asker'
      const url = `?collection=${own}&filename=plan.png`
      const headers = { ...envelope({ collectionScope: [own] }), ...decided([own], { restricted: [own] }) }

      expect((await GET(request(url, 'test-token', envelope({ collectionScope: [own] })))).status).toBe(404)
      expect((await GET(request(url, 'test-token', headers))).status).toBe(404)
      vi.mocked(admitPersonalShelf).mockResolvedValueOnce([own])
      expect((await GET(request(url, 'test-token', headers))).status).toBe(200)
      expect(admitPersonalShelf).toHaveBeenLastCalledWith(
        { organizationId: 'org_1', conversationId: 's_conv_1', userId: 'user_asker', answerMessageId: null },
        [own],
        expect.objectContaining({ conversationId: 's_conv_1' }),
      )
    })
  })

  describe('with a turn decision', () => {
    it('serves only what the decision lets the turn draw on, though the envelope signs more', async () => {
      vi.mocked(findDocumentStorageKey).mockResolvedValue(STORED)
      const headers = { ...envelope(), ...decided(['base_corpus']) }
      expect((await GET(request('?collection=proj_1&filename=plan.png', 'test-token', headers))).status).toBe(404)
      expect((await GET(request('?collection=base_corpus&filename=plan.png', 'test-token', headers))).status).toBe(200)
    })

    it('serves a socket turn whose envelope signs no scope, from its decision’s shelves (ADR-0194)', async () => {
      vi.mocked(findDocumentStorageKey).mockResolvedValue(STORED)
      const headers = { ...envelope({ collectionScope: [] }), ...decided(['proj_1']) }
      expect((await GET(request('?collection=proj_1&filename=plan.png', 'test-token', headers))).status).toBe(200)
      expect((await GET(request('?collection=base_corpus&filename=plan.png', 'test-token', headers))).status).toBe(404)
    })

    it('serves the document check, a headless socket turn, its focused document from its decision (ADR-0194)', async () => {
      vi.mocked(findDocumentStorageKey).mockResolvedValue(STORED)
      const headers = { ...envelope({ collectionScope: [] }), ...decided(['proj_1'], { kind: 'headless' }) }
      expect((await GET(request('?collection=proj_1&filename=plan.png', 'test-token', headers))).status).toBe(200)
      expect((await GET(request('?collection=base_corpus&filename=plan.png', 'test-token', headers))).status).toBe(404)
    })

    it('404s under a decision made for another conversation or asker', async () => {
      vi.mocked(findDocumentStorageKey).mockResolvedValue(STORED)
      for (const other of [decided(['proj_1'], { conversationId: 's_other' }), decided(['proj_1'], { userId: 'user_other' })]) {
        expect((await GET(request(undefined, 'test-token', { ...envelope(), ...other }))).status).toBe(404)
      }
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
    })

    it('reaches the live check for a restricted folder only when the decision names it', async () => {
      vi.mocked(drawableRestrictedCollections).mockResolvedValue([RESTRICTED])
      vi.mocked(findDocumentStorageKey).mockResolvedValue(STORED)
      const scope = envelope({ collectionScope: ['proj_1', RESTRICTED] })
      const query = `?collection=${RESTRICTED}&filename=gehalt.png`
      expect((await GET(request(query, 'test-token', { ...scope, ...decided(['proj_1', RESTRICTED]) }))).status).toBe(404)
      expect(drawableRestrictedCollections).not.toHaveBeenCalled()
      const allowed = decided(['proj_1', RESTRICTED], { restricted: [RESTRICTED] })
      expect((await GET(request(query, 'test-token', { ...scope, ...allowed }))).status).toBe(200)
    })

    it('refuses a forged decision', async () => {
      const forged = { ...decided(['proj_1']), [TURN_DECISION_SIGNATURE_HEADER]: '0'.repeat(64) }
      expect((await GET(request(undefined, 'test-token', { ...envelope(), ...forged }))).status).toBe(401)
      expect(findDocumentStorageKey).not.toHaveBeenCalled()
    })
  })

  // A person's calibrations for the measuring tool (migration 0236): only under the turn's envelope.
  describe('with calibrationsPage', () => {
    const VERSIONED = { ...STORED, versionId: '22222222-2222-4222-8222-222222222222' }
    const CALIBRATION = {
      id: '33333333-3333-4333-8333-333333333333',
      region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      from: { x: 0.2, y: 0.2 },
      to: { x: 0.4, y: 0.2 },
      lengthM: 5,
      scope: 'page' as const,
      page: 2,
      referenceSize: null,
    }
    const query = '?collection=proj_1&filename=plan.png&calibrationsPage=2'

    beforeEach(() => {
      vi.mocked(findDocumentStorageKey).mockResolvedValue(VERSIONED)
      vi.mocked(activeCalibrationsOfPage).mockResolvedValue([CALIBRATION])
    })

    it('carries the active calibrations of that page of the version, in the signed organization', async () => {
      const res = await GET(request(query, 'test-token', envelope()))
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ documentId: VERSIONED.id, versionId: VERSIONED.versionId, calibrations: [CALIBRATION] })
      expect(vi.mocked(activeCalibrationsOfPage).mock.calls[0]).toEqual([
        'org_1',
        { documentId: VERSIONED.id, versionId: VERSIONED.versionId, page: 2 },
      ])
    })

    it('carries none without an envelope, and reads none', async () => {
      const res = await GET(request(query))
      expect(await res.json()).toMatchObject({ calibrations: [] })
      expect(activeCalibrationsOfPage).not.toHaveBeenCalled()
    })

    it('carries none for a document with no version row', async () => {
      vi.mocked(findDocumentStorageKey).mockResolvedValue(STORED)
      const res = await GET(request(query, 'test-token', envelope()))
      expect(await res.json()).toMatchObject({ calibrations: [] })
      expect(activeCalibrationsOfPage).not.toHaveBeenCalled()
    })

    it('leaves the field out when the query does not ask', async () => {
      const res = await GET(request('?collection=proj_1&filename=plan.png', 'test-token', envelope()))
      expect(await res.json()).not.toHaveProperty('calibrations')
    })

    it('400s a page below 1 or not a whole number', async () => {
      expect((await GET(request('?collection=proj_1&filename=plan.png&calibrationsPage=0'))).status).toBe(400)
      expect((await GET(request('?collection=proj_1&filename=plan.png&calibrationsPage=1.5'))).status).toBe(400)
    })
  })
})

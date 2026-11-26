/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn(),
}))

vi.mock('@/lib/documents/repository', () => ({
  listDocumentIdsInCollection: vi.fn(),
}))

import { GET } from './route'
import { getTenantContext } from '@/lib/db/tenant-context'
import { listDocumentIdsInCollection } from '@/lib/documents/repository'

const ENTWURF = { id: '4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f', filename: 'Plan.pdf', folderId: 'a0000000-0000-4000-8000-000000000001' }
const EINREICHUNG = { id: '5a0d2e3f-4c5b-4d6e-9f70-8b9cad1e2f30', filename: 'Plan.pdf', folderId: 'a0000000-0000-4000-8000-000000000002' }

const request = (query = '?collection=proj_1', token: string | null = 'test-token'): Request =>
  new Request(`http://localhost/api/internal/document-ids${query}`, {
    headers: token ? { 'x-grid-internal-token': token } : {},
  })

describe('GET /api/internal/document-ids', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-token')
    vi.stubEnv('APP_ENV', 'development')
  })

  it('rejects when the token is missing or wrong', async () => {
    expect((await GET(request(undefined, null))).status).toBe(403)
    expect((await GET(request(undefined, 'wrong'))).status).toBe(403)
    expect(listDocumentIdsInCollection).not.toHaveBeenCalled()
  })

  it('fails closed when the token is unconfigured', async () => {
    vi.stubEnv('INTERNAL_API_TOKEN', undefined)
    expect((await GET(request())).status).toBe(503)
  })

  it('400s a query without a collection', async () => {
    expect((await GET(request(''))).status).toBe(400)
    expect((await GET(request('?collection='))).status).toBe(400)
    expect(listDocumentIdsInCollection).not.toHaveBeenCalled()
  })

  it('answers every document of the collection with its id, file name and folder, same-named ones apart', async () => {
    vi.mocked(listDocumentIdsInCollection).mockResolvedValue([ENTWURF, EINREICHUNG])
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ documents: [ENTWURF, EINREICHUNG] })
    expect(vi.mocked(listDocumentIdsInCollection).mock.calls[0]).toEqual(['proj_1', undefined])
  })

  it('narrows to the organization the query names, read as the ingestion reader so a personal shelf is listed', async () => {
    let seen: unknown = null
    vi.mocked(listDocumentIdsInCollection).mockImplementation(async () => {
      seen = getTenantContext()
      return []
    })
    await GET(request('?collection=personal_org_1&organizationId=org_1'))
    expect(vi.mocked(listDocumentIdsInCollection).mock.calls[0]).toEqual(['personal_org_1', 'org_1'])
    expect(seen).toMatchObject({ kind: 'tenant', organizationId: 'org_1', userId: null, systemReader: 'ingestion' })
  })

  it('does not answer an empty list when the lookup fails', async () => {
    vi.mocked(listDocumentIdsInCollection).mockRejectedValue(new Error('db down'))
    expect((await GET(request())).status).toBe(500)
  })
})

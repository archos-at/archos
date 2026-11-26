/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mail-thread/document-threads', () => ({ mailThreadsOfDocuments: vi.fn(async () => new Map()) }))
vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user_1',
    email: 'a@b.test',
    organizationId: 'org_1',
    organizationMembershipId: 'om_1',
    role: 'admin',
    permissions: [],
    accessToken: '',
    name: null,
    featureFlags: null,
  }),
}))
vi.mock('@/lib/documents/resolve-by-id', () => ({ resolveShelfDocumentsById: vi.fn() }))
vi.mock('@/lib/documents/lifecycle', () => ({
  summarizeDocumentVersions: vi.fn().mockResolvedValue(new Map()),
}))

import { ForbiddenError } from '@/lib/api/errors'
import type { ListedDocument } from '@/lib/documents/document-listing'
import { resolveShelfDocumentsById } from '@/lib/documents/resolve-by-id'
import { BY_ID_PATH, ByIdResolveError, createDocumentByIdClient } from '@/lib/documents/by-id-client'
import { DOCUMENT_ID_LOOKUP_MAX_IDS } from '@/lib/documents/id-lookup'
import { POST } from './route'

const DRAFT_ID = '4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f'
const SUBMISSION_ID = '5a0d2e3f-4c5b-4d6e-9f70-8b9cad1e2f30'

const requests: Array<{ ids: string[] }> = []
const client = createDocumentByIdClient(async (path, init) => {
  if (path !== BY_ID_PATH) throw new Error(`no route for ${path}`)
  requests.push({ ids: (JSON.parse(String(init?.body)) as { ids: string[] }).ids })
  return POST(new Request(new URL(path, 'https://grid.test'), init), { params: Promise.resolve({}) })
})

const listed = (id: string, folderId: string): ListedDocument =>
  ({
    id,
    filename: 'Plan.pdf',
    displayName: null,
    fileSize: 10,
    contentType: 'application/pdf',
    status: 'completed',
    authoredBy: 'user',
    authoredByProducer: null,
    publishedVersionId: null,
    lifecycle: 'active',
    collectionName: 'proj_c',
    folderId,
    originPath: null,
    contentHash: null,
    createdAt: new Date('2020-01-01T00:00:00Z'),
    updatedAt: new Date('2020-01-01T00:00:00Z'),
    errorMessage: null,
    quarantine: null,
    assignees: [],
  }) as ListedDocument

const post = (body: unknown, query = '') =>
  POST(
    new Request(`https://grid.test${BY_ID_PATH}${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  )

beforeEach(() => {
  requests.length = 0
  vi.mocked(resolveShelfDocumentsById).mockReset()
  vi.mocked(resolveShelfDocumentsById).mockResolvedValue([])
})

describe('POST /api/documents/by-id', () => {
  it('answers the listing row of each document an id names, two same-named ones in different folders apart', async () => {
    vi.mocked(resolveShelfDocumentsById).mockResolvedValue([listed(DRAFT_ID, 'folder-entwurf'), listed(SUBMISSION_ID, 'folder-einreichung')])

    const rows = await client.project('proj_1', [DRAFT_ID, SUBMISSION_ID])

    expect(resolveShelfDocumentsById).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_1' }),
      { kind: 'project', projectId: 'proj_1' },
      [DRAFT_ID, SUBMISSION_ID],
    )
    expect(rows.map((row) => [row.id, row.filename, row.folderId])).toEqual([
      [DRAFT_ID, 'Plan.pdf', 'folder-entwurf'],
      [SUBMISSION_ID, 'Plan.pdf', 'folder-einreichung'],
    ])
    expect(rows[0]).toMatchObject({ createdAt: '2020-01-01T00:00:00.000Z' })
  })

  it('resolves on the office shelf, which takes no project', async () => {
    await client.officeShelf([DRAFT_ID])
    expect(resolveShelfDocumentsById).toHaveBeenCalledWith(expect.anything(), { kind: 'office_shelf' }, [DRAFT_ID])
  })

  it('resolves only the caller’s own personal shelf', async () => {
    await post({ scope: 'personal', ids: [DRAFT_ID] })
    expect(resolveShelfDocumentsById).toHaveBeenCalledWith(expect.anything(), { kind: 'personal', userId: 'user_1' }, [DRAFT_ID])
  })

  it('asks nothing for no ids, and splits a long batch into requests the route accepts', async () => {
    expect(await client.project('proj_1', [])).toEqual([])
    expect(resolveShelfDocumentsById).not.toHaveBeenCalled()

    const ids = Array.from({ length: DOCUMENT_ID_LOOKUP_MAX_IDS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    await client.project('proj_1', ids)
    expect(requests.map((request) => request.ids.length)).toEqual([DOCUMENT_ID_LOOKUP_MAX_IDS, 1])
  })

  it('refuses a body that names a file instead of an id, a batch past the bound, or a project shelf without its project', async () => {
    expect((await post({ projectId: 'proj_1', ids: ['Plan.pdf'] })).status).toBe(400)
    const ids = Array.from({ length: DOCUMENT_ID_LOOKUP_MAX_IDS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect((await post({ projectId: 'proj_1', ids })).status).toBe(400)
    expect((await post({ ids: [DRAFT_ID] })).status).toBe(400)
    expect(resolveShelfDocumentsById).not.toHaveBeenCalled()
  })

  it('carries the service refusal through as the status, and a transport failure as 0', async () => {
    vi.mocked(resolveShelfDocumentsById).mockRejectedValueOnce(new ForbiddenError('no'))
    await expect(client.project('proj_1', [DRAFT_ID])).rejects.toMatchObject({ status: 403 })

    const offline = createDocumentByIdClient(async () => {
      throw new TypeError('network')
    })
    await expect(offline.project('proj_1', [DRAFT_ID])).rejects.toEqual(new ByIdResolveError(0))
  })
})

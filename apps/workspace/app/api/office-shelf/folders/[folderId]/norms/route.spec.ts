/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'

const session = {
  userId: 'user-1',
  organizationId: 'org-1',
  email: 'lena@example.test',
  role: 'member',
  permissions: [ORG_PERMISSIONS.officeShelfManage] as string[],
  featureFlags: ['office-standards'] as string[],
}

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockImplementation(async () => session),
  authzErrorResponse: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/base-knowledge/office/folder-norms-repository', () => ({
  listUndecidedFolderFiles: vi.fn(async () => [
    { id: 'doc-1', fileName: 'OENORM_B_1600.pdf', folderId: 'f' },
    { id: 'doc-2', fileName: 'Grundriss.pdf', folderId: 'f' },
  ]),
  keepAsOrdinaryFiles: vi.fn(),
}))
vi.mock('@/lib/base-knowledge/office/service', () => ({ proposeBaseKnowledge: vi.fn() }))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({ shelfReaderFor: vi.fn(async () => ({ kind: 'reviewer' })) }))

import { keepAsOrdinaryFiles, listUndecidedFolderFiles } from '@/lib/base-knowledge/office/folder-norms-repository'
import { GET, POST } from './route'

const FOLDER_ID = '7c0f2a8e-3f1b-4c55-9d1e-2a6b8c4d0e11'
const path = `http://localhost/api/office-shelf/folders/${FOLDER_ID}/norms`
const ctx = (folderId = FOLDER_ID) => ({ params: Promise.resolve({ folderId }) })
const decide = (body: unknown, folderId = FOLDER_ID) =>
  POST(new Request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ctx(folderId))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('REQUIRE_AUTH', 'true')
  session.permissions = [ORG_PERMISSIONS.officeShelfManage]
  session.featureFlags = ['office-standards']
})

afterEach(() => vi.unstubAllEnvs())

describe('/api/office-shelf/folders/[folderId]/norms', () => {
  it('answers the folder’s norms to an office shelf manager', async () => {
    const response = await GET(new Request(`${path}?limit=10`), ctx())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ folderId: FOLDER_ID, total: 1, nextCursor: null })
  })

  it('keeps them as ordinary files', async () => {
    const response = await decide({ action: 'keep' })
    expect(response.status).toBe(200)
    expect(keepAsOrdinaryFiles).toHaveBeenCalledWith('org-1', ['doc-1'], 'user-1')
  })

  it('is forbidden to a member who may not manage the office shelf', async () => {
    session.permissions = []
    expect((await GET(new Request(path), ctx())).status).toBe(403)
    expect((await decide({ action: 'keep' })).status).toBe(403)
    expect(listUndecidedFolderFiles).not.toHaveBeenCalled()
  })

  it('is not found without office-standards, or for a folder id that is none', async () => {
    session.featureFlags = []
    expect((await GET(new Request(path), ctx())).status).toBe(404)
    session.featureFlags = ['office-standards']
    expect((await GET(new Request(path), ctx('not-a-folder'))).status).toBe(404)
    expect(listUndecidedFolderFiles).not.toHaveBeenCalled()
  })

  it('refuses an action it does not know', async () => {
    expect((await decide({ action: 'delete' })).status).toBe(400)
    expect(keepAsOrdinaryFiles).not.toHaveBeenCalled()
  })
})

/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const SESSION = {
  userId: 'user-1',
  organizationId: 'org-1',
  email: 'test@grid.com',
  role: 'admin',
  permissions: [],
  featureFlags: ['office-standards'],
}

vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: vi.fn(async () => SESSION) }))
vi.mock('@/lib/documents/move-to-folder', () => ({
  moveDocumentToFolder: vi.fn(async ({ documentId, folderId }: { documentId: string; folderId: string | null }) => ({
    ok: true,
    document: { id: documentId, folderId },
  })),
}))
vi.mock('@/lib/office-shelf/folder-service', () => ({
  officeShelfHiddenFolderIds: vi.fn(async () => ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']),
}))
vi.mock('@/lib/office-shelf/repository', () => ({
  findOfficeShelfDocument: vi.fn(async (id: string) => ({ id, folderId: id === 'norm-1' ? '00000000-0000-4000-8000-000000000002' : null })),
}))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({ shelfReaderFor: vi.fn(async () => ({ kind: 'reviewer' })) }))

import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { PATCH } from './route'

const STANDARDS = '00000000-0000-4000-8000-000000000001'
const FIRE = '00000000-0000-4000-8000-000000000002'
const PLANS = '00000000-0000-4000-8000-000000000003'

const move = (id: string, folderId: string | null) =>
  PATCH(
    new Request(`https://grid.test/api/documents/${id}/folder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId }),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  )

beforeEach(() => vi.clearAllMocks())

describe('PATCH /api/documents/[id]/folder, with the office keeping its own standards', () => {
  it('refuses to take an Ordner file under the standards tree, and moves nothing', async () => {
    const response = await move('plan-1', FIRE)

    expect(response.status).toBe(422)
    expect(moveDocumentToFolder).not.toHaveBeenCalled()
  })

  it('moves a norm within the standards tree, and an Ordner file within the Ordner', async () => {
    expect((await move('norm-1', STANDARDS)).status).toBe(200)
    expect((await move('plan-1', PLANS)).status).toBe(200)
    expect(moveDocumentToFolder).toHaveBeenCalledTimes(2)
  })
})

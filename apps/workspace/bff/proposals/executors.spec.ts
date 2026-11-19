import { beforeEach, describe, expect, it, vi } from 'vitest'

const FOLDERS = [
  { id: 'folder-plans', path: 'Pläne' },
  { id: 'folder-standards', path: 'Grundlagen des Büros' },
  { id: 'folder-fire', path: 'Grundlagen des Büros/Brandschutz' },
]

vi.mock('server-only', () => ({}))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))
vi.mock('@/lib/office-shelf/folder-service', () => ({
  listOfficeShelfFolders: vi.fn(async () => FOLDERS),
  officeShelfHiddenFolderIds: vi.fn(async () => ['folder-standards', 'folder-fire']),
  ensureOfficeShelfFolderPaths: vi.fn(),
  updateOfficeShelfFolder: vi.fn(),
}))
vi.mock('@/lib/office-shelf/repository', () => ({
  findOfficeShelfDocument: vi.fn(async (id: string) => ({ id, folderId: id === 'doc-norm' ? 'folder-fire' : null })),
}))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({ shelfReaderFor: vi.fn(async () => ({ kind: 'reviewer' })) }))
vi.mock('@/lib/office-shelf/service', async (original) => ({
  ...(await original<typeof import('@/lib/office-shelf/service')>()),
  resolveOfficeShelfDocumentsByName: vi.fn(async (_session: unknown, names: string[]) =>
    names.map((name) => ({ id: name === 'Brandschutz-Richtlinie.pdf' ? 'doc-norm' : 'doc-plan', filename: name, createdAt: '2026-11-01T00:00:00Z' })),
  ),
}))
vi.mock('@/lib/documents/move-to-folder', () => ({
  moveDocumentToFolder: vi.fn(async ({ documentId, folderId }: { documentId: string; folderId: string | null }) => ({
    ok: true,
    document: { id: documentId, folderId },
  })),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { applyFileOperations } from './executors'

const SESSION = { userId: 'user-1', organizationId: 'org-1', permissions: [], featureFlags: ['office-standards'] } as unknown as AuthorizedSession
const request = new Request('http://localhost/api/proposals')

beforeEach(() => vi.clearAllMocks())

describe('a proposed move on the office shelf', () => {
  it('takes no Ordner file under the standards tree', async () => {
    const results = await applyFileOperations(
      { operation: 'move', operations: [{ source: 'office', document: 'Plan.pdf', target_folder: 'Grundlagen des Büros/Brandschutz' }] },
      { session: SESSION, projectId: null, request },
    )

    expect(results).toEqual([expect.objectContaining({ ok: false })])
    expect(moveDocumentToFolder).not.toHaveBeenCalled()
  })

  it('moves a norm within the standards tree, and a file within the Ordner', async () => {
    const results = await applyFileOperations(
      {
        operation: 'move',
        operations: [
          { source: 'office', document: 'Brandschutz-Richtlinie.pdf', target_folder: 'Grundlagen des Büros' },
          { source: 'office', document: 'Plan.pdf', target_folder: 'Pläne' },
        ],
      },
      { session: SESSION, projectId: null, request },
    )

    expect(results.map((result) => result.ok)).toEqual([true, true])
    expect(moveDocumentToFolder).toHaveBeenCalledTimes(2)
  })
})

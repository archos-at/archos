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
vi.mock('@/lib/projects/folder-service', () => ({
  listProjectFolders: vi.fn(async () => FOLDERS),
  createProjectFolder: vi.fn(),
  ensureProjectFolderPaths: vi.fn(),
  updateProjectFolder: vi.fn(),
}))
vi.mock('@/lib/documents/document-listing', () => ({ resolveProjectDocumentsByName: vi.fn(async () => []) }))
vi.mock('@/lib/documents/resolve-by-id', () => ({ resolveShelfDocumentsById: vi.fn(async () => []) }))
vi.mock('@/lib/documents/document-edits', () => ({ renameDocument: vi.fn() }))
vi.mock('@/lib/documents/move-to-folder', () => ({
  moveDocumentToFolder: vi.fn(async ({ documentId, folderId }: { documentId: string; folderId: string | null }) => ({
    ok: true,
    document: { id: documentId, folderId },
  })),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { renameDocument } from '@/lib/documents/document-edits'
import { NameConflictError, type NameConflict } from '@/lib/documents/name-conflict'
import { resolveProjectDocumentsByName, type ListedDocument } from '@/lib/documents/document-listing'
import { resolveShelfDocumentsById } from '@/lib/documents/resolve-by-id'
import { applyFileOperations, resolveItemDocuments } from './executors'

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

describe('a proposed move in a project with two documents of one name in different folders', () => {
  const DRAFT = '4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f'
  const SUBMISSION = '5a0d2e3f-4c5b-4d6e-9f70-8b9cad1e2f30'
  const listed = (id: string) => ({ id, filename: 'Plan.pdf', createdAt: '2026-11-01T00:00:00Z' }) as unknown as ListedDocument
  const move = (item: Record<string, unknown>) =>
    applyFileOperations(
      { operation: 'move', operations: [{ source: 'project', document: 'Plan.pdf', target_folder: 'Pläne', ...item }] },
      { session: SESSION, projectId: 'proj-1', request },
    )

  beforeEach(() => {
    vi.mocked(resolveProjectDocumentsByName).mockResolvedValue([listed(DRAFT), listed(SUBMISSION)])
    vi.mocked(resolveShelfDocumentsById).mockImplementation(async (_session, _shelf, ids) => ids.map(listed))
  })

  it('moves the document the proposal names by id, looked up on the project shelf the reader may see', async () => {
    const results = await move({ document_id: SUBMISSION })

    expect(results).toEqual([expect.objectContaining({ ok: true })])
    expect(resolveShelfDocumentsById).toHaveBeenCalledWith(SESSION, { kind: 'project', projectId: 'proj-1' }, [SUBMISSION])
    expect(moveDocumentToFolder).toHaveBeenCalledWith({ documentId: SUBMISSION, folderId: 'folder-plans' }, SESSION)
    expect(resolveProjectDocumentsByName).not.toHaveBeenCalled()
  })

  it('refuses an id the reader may not see on that shelf, rather than falling back to the name', async () => {
    vi.mocked(resolveShelfDocumentsById).mockResolvedValue([])

    const results = await move({ document_id: SUBMISSION })

    expect(results).toEqual([expect.objectContaining({ ok: false })])
    expect(moveDocumentToFolder).not.toHaveBeenCalled()
  })

  it('refuses a name two documents carry as ambiguous, instead of moving the newest', async () => {
    const results = await move({})

    expect(results).toEqual([{ label: 'Plan.pdf', ok: false, reason: expect.stringContaining('mehrmals') }])
    expect(moveDocumentToFolder).not.toHaveBeenCalled()
  })

  it('still moves by name when exactly one document in the project carries it', async () => {
    vi.mocked(resolveProjectDocumentsByName).mockResolvedValue([listed(DRAFT)])

    expect(await move({})).toEqual([expect.objectContaining({ ok: true })])
    expect(moveDocumentToFolder).toHaveBeenCalledWith({ documentId: DRAFT, folderId: 'folder-plans' }, SESSION)
  })

  it('lists the documents a proposal touches by id, and leaves out a name it cannot tell apart', async () => {
    const items = [
      { source: 'project' as const, document: 'Plan.pdf', document_id: DRAFT },
      { source: 'project' as const, document: 'Plan.pdf' },
    ]

    expect(await resolveItemDocuments(SESSION, 'proj-1', items)).toEqual([{ id: DRAFT, name: 'Plan.pdf' }])
  })

  it('hides a proposal naming a document id the reader may not see', async () => {
    vi.mocked(resolveShelfDocumentsById).mockResolvedValue([])

    expect(await resolveItemDocuments(SESSION, 'proj-1', [{ source: 'project', document: 'Plan.pdf', document_id: DRAFT }])).toBeNull()
  })
})

describe('a proposed change that meets a name already in the folder', () => {
  const DOC = '4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f'
  const CONFLICT: NameConflict = {
    reason: 'name_conflict',
    name: 'Plan.pdf',
    folderId: 'folder-plans',
    existingDocumentId: '5a0d2e3f-4c5b-4d6e-9f70-8b9cad1e2f30',
    existingName: 'Plan.pdf',
    suggestedName: 'Plan 2.pdf',
  }

  beforeEach(() => {
    vi.mocked(resolveShelfDocumentsById).mockImplementation(
      async (_session, _shelf, ids) => ids.map((id) => ({ id, filename: 'Plan.pdf', createdAt: '2026-11-01T00:00:00Z' })) as unknown as ListedDocument[],
    )
  })

  it('reports a move into a folder holding the name as a typed conflict, and never asks to replace', async () => {
    vi.mocked(moveDocumentToFolder).mockResolvedValueOnce({ ok: false, error: 'A document of this name is already in the destination folder.', conflict: CONFLICT })

    const results = await applyFileOperations(
      { operation: 'move', operations: [{ source: 'project', document: 'Plan.pdf', document_id: DOC, target_folder: 'Pläne' }] },
      { session: SESSION, projectId: 'proj-1', request },
    )

    expect(results).toEqual([{ label: 'Plan.pdf', ok: false, reason: 'A document named "Plan.pdf" is already in this folder.', conflict: CONFLICT }])
    expect(results[0]?.reason).not.toContain('onConflict')
    expect(moveDocumentToFolder).toHaveBeenCalledWith({ documentId: DOC, folderId: 'folder-plans' }, SESSION)
  })

  it('reports a rename to a name the folder holds as the same typed conflict', async () => {
    vi.mocked(renameDocument).mockRejectedValueOnce(new NameConflictError(CONFLICT))

    const results = await applyFileOperations(
      { operation: 'rename', operations: [{ source: 'project', document: 'Entwurf.pdf', document_id: DOC, new_display_name: 'Plan.pdf' }] },
      { session: SESSION, projectId: 'proj-1', request },
    )

    expect(results).toEqual([{ label: 'Entwurf.pdf', ok: false, reason: 'A document named "Plan.pdf" is already in this folder.', conflict: CONFLICT }])
  })

  it('carries no conflict on a refusal that is not one', async () => {
    vi.mocked(moveDocumentToFolder).mockResolvedValueOnce({ ok: false, error: 'Folder not found in this project.' })

    const [result] = await applyFileOperations(
      { operation: 'move', operations: [{ source: 'project', document: 'Plan.pdf', document_id: DOC, target_folder: 'Pläne' }] },
      { session: SESSION, projectId: 'proj-1', request },
    )

    expect(result).toEqual({ label: 'Plan.pdf', ok: false, reason: 'Folder not found in this project.' })
  })
})

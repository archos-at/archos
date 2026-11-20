/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  admin,
  bin,
  closeBinFixtures,
  collectionRef,
  db,
  doc,
  documentService,
  folder,
  folderState,
  folders,
  gf,
  inOrg,
  lifecycle,
  openBinFixtures,
  pl,
  projectId,
  queueRow,
  seed,
  setting,
  url,
  visibleDocumentNames,
  wipe,
} from './folder-bin.fixtures'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/sharing/directory', () => ({ loadOrganizationDirectory: vi.fn(async () => new Map()) }))
vi.mock('@/lib/documents/collection-file-ref', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/collection-file-ref')>()),
  purgeIngestedChunks: vi.fn(async () => true),
}))
vi.mock('@/lib/documents/document-dispatch', () => ({
  dispatchDocument: vi.fn(async () => ({ jobId: 'job', status: 'pending' })),
}))
const projectState = vi.hoisted(() => ({ closed: false }))
vi.mock('@/lib/authz/projects', async () => {
  const { NotFoundError } = await import('@/lib/api/errors')
  const { keptWhenClosed, projectClosedError } = await import('@/lib/projects/project-status')
  return {
    requireProjectAccess: vi.fn(
      async (
        session: { permissions: string[] },
        _projectId: string,
        needed: string | readonly string[],
        options: { evenWhenClosed?: boolean } = {}
      ) => {
        const asked = (Array.isArray(needed) ? needed : [needed]) as Parameters<typeof keptWhenClosed>[0]
        const readOnly = projectState.closed && !options.evenWhenClosed
        const wanted = readOnly ? keptWhenClosed(asked) : asked
        if (wanted.length === 0) throw projectClosedError()
        const closed = projectState.closed
        if (session.permissions.includes('org:projects:administer')) return { role: 'project-admin', closed, readsBecauseClosed: false }
        if (!wanted.some((permission) => session.permissions.includes(permission))) throw new NotFoundError()
        return { role: session.permissions.includes('project:manage') ? 'project-admin' : 'project-editor', closed, readsBecauseClosed: false }
      }
    ),
  }
})
vi.mock('@/lib/auth/membership-roles', () => ({ resolveMembershipRoles: vi.fn(async () => null) }))
vi.mock('@/lib/authz/folder-roles', async () => {
  const { levelsOf } = await import('@/lib/projects/folder-bin.fixtures')
  return { heldFolderLevels: vi.fn(async (_org: string, membershipId: string) => levelsOf(membershipId)) }
})
vi.mock('@/lib/documents/lifecycle', () => ({
  redispatchPublishedVersion: vi.fn(async () => ({ jobId: 'job', status: 'pending' })),
}))

describe.skipIf(!url)('the Papierkorb against live Postgres (migration 0115)', () => {
  beforeAll(openBinFixtures)

  beforeEach(async () => {
    await wipe()
    await seed()
    await setting.saveDeletedFolderContentPolicy(admin, 'unchanged', new Request('http://test'))
    vi.mocked(collectionRef.purgeIngestedChunks).mockReset()
    vi.mocked(collectionRef.purgeIngestedChunks).mockResolvedValue(true)
    vi.mocked(documentService.dispatchDocument).mockClear()
    vi.mocked(lifecycle.redispatchPublishedVersion).mockClear()
  })

  afterAll(closeBinFixtures)

  describe('the project shelf: the delete is the bin, and a binned folder is no folder of the shelf', () => {
    it('deleteProjectFolder moves the folder to the bin with its contents instead of re-filing them into the parent', async () => {
      const result = await folders.deleteProjectFolder({ projectId, folderId: folder.officeShelf }, pl)
      expect(result).toMatchObject({ documentsBinned: 1, foldersBinned: 1 })
      expect(await folderState(folder.officeShelf)).toMatchObject({ bin_root_id: folder.officeShelf })
      expect((await folderState(folder.officeShelf))?.deleted_at).not.toBeNull()
      const [row] = await inOrg(() =>
        db.execute<{ folder_id: string }>(sql`SELECT folder_id FROM documents WHERE id = ${doc.officeShelf}::uuid`)
      )
      expect(String(row.folder_id)).toBe(folder.officeShelf)
      expect(await visibleDocumentNames(pl)).not.toContain('Archiv.pdf')
      expect((await queueRow(folder.officeShelf))[0]?.status).toBe('pending')
    })

    it('frees the name: a folder upload of the same path creates a new folder rather than matching the binned one', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      const ensured = await folders.ensureProjectFolderPaths({ projectId, parentId: null, paths: ['Pläne/Archiv'] }, pl)
      expect(ensured.ok).toBe(true)
      const created = ensured.ok ? ensured.folderIdByPath['Pläne/Archiv'] : ''
      expect([folder.plans, folder.officeShelf]).not.toContain(created)
      expect((await folders.listProjectFolders(projectId, pl)).map((row) => row.path).sort()).toEqual([
        'Pläne',
        'Pläne/Archiv',
        'Verwaltung',
      ])
    })

    it('answers a binned folder as missing to a rename, a move into it and a new subfolder', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await expect(folders.updateProjectFolder({ projectId, folderId: folder.plans, name: 'Neu' }, pl)).resolves.toEqual({
        ok: false,
        error: 'Folder not found.',
      })
      await expect(
        folders.updateProjectFolder({ projectId, folderId: folder.admin, parentId: folder.plans }, gf)
      ).rejects.toMatchObject({ status: 404 })
      await expect(folders.createProjectFolder({ projectId, parentId: folder.officeShelf, name: 'Neu' }, pl)).rejects.toMatchObject({
        status: 404,
      })
    })
  })
})

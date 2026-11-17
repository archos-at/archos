/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import {
  admin,
  bin,
  claimable,
  closeBinFixtures,
  collectionRef,
  db,
  documentService,
  folder,
  lifecycle,
  manager,
  openBinFixtures,
  pl,
  projectId,
  seed,
  setting,
  url,
  wipe,
  withPlatformAccess,
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
vi.mock('@/lib/documents/document-edits', () => ({
  eraseProjectDocument: vi.fn(async (doc: { id: string; organizationId: string; projectId: string }) => {
    const { deleteProjectDocument } = await import('@/lib/documents/repository')
    await deleteProjectDocument(doc.id, doc.organizationId, doc.projectId)
    return true
  }),
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

  describe('a queue row never reads as waiting while the purger will not take it (attempts at the cap)', () => {
    async function giveUpOn(folderId: string): Promise<void> {
      await withPlatformAccess('test: the purger gave up', () =>
        db.execute(sql`UPDATE deletion_queue SET status = 'failed', attempts = 10, claimed_at = now() - interval '2 hours',
                              purge_after = now() - interval '1 day'
                       WHERE entity_type = 'folder' AND entity_id = ${folderId}`)
      )
    }

    async function attemptsOf(folderId: string): Promise<{ status: string; attempts: number }> {
      const [row] = await withPlatformAccess('test: read the attempts', () =>
        db.execute<{ status: string; attempts: number }>(sql`
          SELECT status, attempts FROM deletion_queue WHERE entity_type = 'folder' AND entity_id = ${folderId}`)
      )
      return { status: row.status, attempts: Number(row.attempts) }
    }

    it('„Endgültig löschen" that fails on a row the purger gave up on leaves it failed, not pending for nobody', async () => {
      const edits = await import('@/lib/documents/document-edits')
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await giveUpOn(folder.plans)
      vi.mocked(edits.eraseProjectDocument).mockRejectedValueOnce(new Error('object store down'))

      await expect(bin.purgeFolderFromBinNow(manager, { projectId, folderId: folder.plans })).rejects.toThrow('object store down')

      expect((await attemptsOf(folder.plans)).status).toBe('failed')
      expect(await claimable()).not.toContain(folder.plans)
      await expect(bin.purgeFolderFromBinNow(manager, { projectId, folderId: folder.plans })).resolves.toMatchObject({ status: 'purged' })
      expect((await attemptsOf(folder.plans)).status).toBe('purged')
    })

    it('a failed „Endgültig löschen" that spends the last attempt ends failed too', async () => {
      const edits = await import('@/lib/documents/document-edits')
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await withPlatformAccess('test: nine failed purges', () =>
        db.execute(sql`UPDATE deletion_queue SET attempts = 9 WHERE entity_type = 'folder' AND entity_id = ${folder.plans}`)
      )
      vi.mocked(edits.eraseProjectDocument).mockRejectedValueOnce(new Error('object store down'))

      await expect(bin.purgeFolderFromBinNow(manager, { projectId, folderId: folder.plans })).rejects.toThrow('object store down')

      expect(await attemptsOf(folder.plans)).toEqual({ status: 'failed', attempts: 10 })
    })

    it('one with attempts left goes back to pending, and the purger takes it', async () => {
      const edits = await import('@/lib/documents/document-edits')
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      vi.mocked(edits.eraseProjectDocument).mockRejectedValueOnce(new Error('object store down'))

      await expect(bin.purgeFolderFromBinNow(manager, { projectId, folderId: folder.plans })).rejects.toThrow('object store down')

      expect(await attemptsOf(folder.plans)).toEqual({ status: 'pending', attempts: 1 })
      await withPlatformAccess('test: the backoff is over', () =>
        db.execute(sql`UPDATE deletion_queue SET claimed_at = now() - interval '2 hours', purge_after = now() - interval '1 minute'
                       WHERE entity_type = 'folder' AND entity_id = ${folder.plans}`)
      )
      expect(await claimable()).toContain(folder.plans)
    })

    it('the database refuses a pending row at the cap, so no row waits for a claim that never comes (migration 0227)', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await giveUpOn(folder.plans)

      await expect(
        withPlatformAccess('test: strand the row as the old release did', () =>
          db.execute(sql`UPDATE deletion_queue SET status = 'pending', attempts = 11 WHERE entity_type = 'folder' AND entity_id = ${folder.plans}`)
        )
      ).rejects.toThrow()

      expect(await attemptsOf(folder.plans)).toEqual({ status: 'failed', attempts: 10 })
    })

    it('a purge finished in a request is not pulled back by the late answer of a second holder', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      const [{ id }] = await withPlatformAccess('test: the row id', () =>
        db.execute<{ id: string }>(sql`SELECT id FROM deletion_queue WHERE entity_type = 'folder' AND entity_id = ${folder.plans}`)
      )
      await bin.purgeFolderFromBinNow(manager, { projectId, folderId: folder.plans })
      expect((await attemptsOf(folder.plans)).status).toBe('purged')

      const { markFailed, releaseHeld } = await import('../../purger/db.js')
      const client = postgres(url as string, { prepare: false, max: 1 })
      const claim = { id, claim_token: new Date().toISOString() }
      try {
        await markFailed(client as never, claim, 'folder purge answered 502')
        await releaseHeld(client as never, claim)
      } finally {
        await client.end()
      }

      expect((await attemptsOf(folder.plans)).status).toBe('purged')
    })
  })
})

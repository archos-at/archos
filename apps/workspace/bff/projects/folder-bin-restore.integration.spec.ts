/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { restrictedCollectionName } from '@/lib/authz/folder-access-rule'
import {
  COLLECTION,
  ORG,
  PL,
  USER,
  access,
  admin,
  bh,
  bin,
  closeBinFixtures,
  collectionRef,
  db,
  doc,
  docsRepo,
  documentRow,
  documentService,
  folder,
  folderState,
  gf,
  ids,
  inOrg,
  insertDocument,
  insertFolder,
  lifecycle,
  manager,
  openBinFixtures,
  pl,
  projectId,
  queueRow,
  queuedJobs,
  runRestoreJob,
  seed,
  sessionOf,
  setting,
  url,
  visibleDocumentNames,
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
vi.mock('@/lib/documents/folder-path', () => ({ resolveDocumentFolderPath: vi.fn(async () => null) }))
vi.mock('@/lib/documents/document-dispatch', () => ({
  dispatchDocument: vi.fn(async () => ({ jobId: 'job', status: 'pending' })),
}))
vi.mock('@/lib/documents/ingest-dispatch', () => ({
  INGEST_DISPATCH_FAILED_MESSAGE: 'dispatch failed',
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

  describe('restoring', () => {
    it('brings the folder back with exactly the access it had, and reads its documents into the right collections', async () => {
      const before = await Promise.all([gf, bh, pl].map((session) => visibleDocumentNames(session)))
      await bin.moveFolderToBin(gf, { projectId, folderId: folder.admin })
      expect(await visibleDocumentNames(bh)).toEqual(['Archiv.pdf', 'Lageplan.pdf', 'Plan.pdf'])

      const restored = await bin.restoreFolderFromBin(gf, { projectId, folderId: folder.admin })
      expect(restored).toMatchObject({ restoredTo: 'original', folders: 3, documents: 3 })
      expect(await Promise.all([gf, bh, pl].map((session) => visibleDocumentNames(session)))).toEqual(before)
      expect(await access.getHiddenFolderIds(pl, projectId)).toEqual(expect.arrayContaining([folder.contracts, folder.old]))
      expect(await access.canWriteFolder(bh, projectId, folder.contracts)).toBe(false)
      expect(await access.canWriteFolder(gf, projectId, folder.contracts)).toBe(true)
      expect(documentService.dispatchDocument).not.toHaveBeenCalled()
      const [job] = await queuedJobs('restore_folder_bin')
      expect(job.priority).toBe(1)
      await runRestoreJob(gf, job.payload)
      expect(vi.mocked(documentService.dispatchDocument).mock.calls.every(([input]) => input.priority === 'bulk')).toBe(true)
      const dispatched = new Map(
        vi.mocked(documentService.dispatchDocument).mock.calls.map(([input]) => [input.filename, input.collectionName])
      )
      expect(dispatched.get('Vertrag.pdf')).toBe(restrictedCollectionName(COLLECTION, folder.contracts))
      expect(dispatched.get('Protokoll.pdf')).toBe(COLLECTION)
      expect((await queueRow(folder.admin))[0]?.status).toBe('restored')
    })

    it("counts a colleague's held upload only for the people who may see it (ADR-0086)", async () => {
      await inOrg(() =>
        db.execute(sql`
          INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id, folder_id)
          VALUES (${ORG}, 'user_colleague', 'Lohnzettel.pdf', 'k/Lohnzettel.pdf', ${COLLECTION}, 'processing', 'project', ${projectId}::uuid, ${folder.admin}::uuid)
        `)
      )
      await bin.moveFolderToBin(gf, { projectId, folderId: folder.admin })
      const countFor = async (session: typeof gf) =>
        (await bin.listFolderBin(session, projectId)).entries.find((entry) => entry.folderId === folder.admin)?.documents
      expect(await countFor(gf)).toBe(3)
      expect(await countFor(manager)).toBe(4)
    })

    it('marks the documents processing in the restore itself, so a restore cut off never leaves one reading indexed', async () => {
      const quarantined = await insertDocument('Gesperrt.pdf', folder.officeShelf)
      await inOrg(() => db.execute(sql`UPDATE documents SET status = 'quarantined' WHERE id = ${quarantined}::uuid`))
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await bin.restoreFolderFromBin(pl, { projectId, folderId: folder.plans })

      const [job] = await queuedJobs('restore_folder_bin')
      for (const id of [doc.plan, doc.officeShelf]) {
        expect(await documentRow(id)).toMatchObject({ status: 'processing', metadata: expect.objectContaining({ bffJobId: job.job_id }) })
      }
      expect((await documentRow(quarantined)).status).toBe('quarantined')
      await withPlatformAccess('test: the job is gone', () => db.execute(sql`DELETE FROM bff_job_queue WHERE lane = ${ORG}`))
      const stuck = await docsRepo.listStuckProcessingDocuments(new Date(Date.now() + 60_000), 1000)
      expect(stuck.map((row) => row.id)).toEqual(expect.arrayContaining([doc.plan, doc.officeShelf]))
    })

    it('fails a restored document there is nothing to read from, rather than leaving it indexed with no chunks', async () => {
      await inOrg(() => db.execute(sql`UPDATE documents SET storage_key = '' WHERE id = ${doc.officeShelf}::uuid`))
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await bin.restoreFolderFromBin(pl, { projectId, folderId: folder.plans })
      const [job] = await queuedJobs('restore_folder_bin')
      const finished = await runRestoreJob(pl, job.payload)
      expect(finished.counts).toMatchObject({ queued: 1, failed: 1 })
      expect((await documentRow(doc.officeShelf)).status).toBe('failed')
      expect(vi.mocked(documentService.dispatchDocument).mock.calls.map(([input]) => input.filename)).toEqual(['Plan.pdf'])
    })

    it("reads a machine's published document back as its published version", async () => {
      const [report] = ids(
        await inOrg(() =>
          db.execute<{ id: string }>(sql`
            WITH item AS (
              INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id, folder_id,
                                     authored_by, authored_by_producer, authored_by_ref, authored_by_ref_kind)
              VALUES (${ORG}, ${USER}, 'piloti/bericht.pdf', 'k/bericht', ${COLLECTION}, 'completed', 'project', ${projectId}::uuid,
                      ${folder.officeShelf}::uuid, 'agent', 'report', 'answer-1', 'answer_artifact')
              RETURNING id, project_id
            )
            INSERT INTO document_versions (organization_id, document_id, project_id, version_number, state, storage_key,
                                           approved_by, approved_at, published_by, published_at, created_by)
            SELECT ${ORG}, item.id, item.project_id, 1, 'published', 'k/bericht', ${USER}, now(), ${USER}, now(), ${USER} FROM item
            RETURNING document_id AS id`)
        )
      )
      await inOrg(() =>
        db.execute(sql`UPDATE documents SET published_version_id = v.id FROM document_versions v
                       WHERE documents.id = ${report}::uuid AND v.document_id = documents.id`)
      )
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await bin.restoreFolderFromBin(pl, { projectId, folderId: folder.plans })
      const [job] = await queuedJobs('restore_folder_bin')
      await runRestoreJob(pl, job.payload)
      expect(vi.mocked(lifecycle.redispatchPublishedVersion).mock.calls.map(([, row, priority]) => [row.id, priority])).toEqual([
        [report, 'bulk'],
      ])
      expect(vi.mocked(documentService.dispatchDocument).mock.calls.map(([input]) => input.filename)).not.toContain('piloti/bericht.pdf')
    })

    it('stops the walk when the requester lost the project, and leaves the rest to the sweep', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await bin.restoreFolderFromBin(pl, { projectId, folderId: folder.plans })
      const [job] = await queuedJobs('restore_folder_bin')
      const revoked = sessionOf('user_pl', PL, ['project:view'])
      await expect(runRestoreJob(revoked, job.payload)).resolves.toMatchObject({ cursor: null })
      expect(documentService.dispatchDocument).not.toHaveBeenCalled()
      expect((await documentRow(doc.plan)).status).toBe('processing')
    })

    it('needs write on the deleted folder: a reader sees the entry but may not restore it', async () => {
      await bin.moveFolderToBin(gf, { projectId, folderId: folder.contracts })
      const listing = await bin.listFolderBin(bh, projectId)
      expect(listing.entries.map((entry) => [entry.name, entry.canRestore])).toEqual([['Verträge', false]])
      await expect(bin.restoreFolderFromBin(bh, { projectId, folderId: folder.contracts })).rejects.toMatchObject({ status: 403 })
      expect((await bin.listFolderBin(pl, projectId)).entries).toEqual([])
      await expect(bin.restoreFolderFromBin(pl, { projectId, folderId: folder.contracts })).rejects.toMatchObject({ status: 404 })
    })

    it('in a closed project the manager restores, and nobody else does (ADR-0090)', async () => {
      await bin.moveFolderToBin(gf, { projectId, folderId: folder.contracts })
      projectState.closed = true
      try {
        expect((await bin.listFolderBin(gf, projectId)).entries.map((entry) => entry.canRestore)).toEqual([false])
        await expect(bin.restoreFolderFromBin(gf, { projectId, folderId: folder.contracts })).rejects.toMatchObject({ status: 403 })
        expect((await bin.listFolderBin(manager, projectId)).entries.map((entry) => entry.canRestore)).toEqual([true])
        const restored = await bin.restoreFolderFromBin(manager, { projectId, folderId: folder.contracts })
        expect(restored.restoredTo).toBe('original')
        expect((await folderState(folder.contracts))?.deleted_at).toBeNull()
      } finally {
        projectState.closed = false
      }
    })

    it('restores to the project root, and says so, when the parent is gone', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.officeShelf })
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      const restored = await bin.restoreFolderFromBin(pl, { projectId, folderId: folder.officeShelf })
      expect(restored.restoredTo).toBe('root')
      expect(await folderState(folder.officeShelf)).toMatchObject({ deleted_at: null, parent_id: null, path: 'Archiv' })
      expect(await visibleDocumentNames(pl)).toContain('Archiv.pdf')
    })

    it('refuses while a living sibling holds the name, and changes nothing', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await insertFolder('Pläne', null, 'Pläne', null)
      await expect(bin.restoreFolderFromBin(pl, { projectId, folderId: folder.plans })).rejects.toMatchObject({
        status: 409,
        details: { reason: bin.FOLDER_NAME_TAKEN_REASON },
      })
      expect((await folderState(folder.plans))?.deleted_at).not.toBeNull()
      expect((await queueRow(folder.plans))[0]?.status).toBe('pending')
    })
  })
})

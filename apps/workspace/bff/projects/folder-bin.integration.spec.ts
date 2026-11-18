/**
 * @vitest-environment node
 *
 * The Papierkorb against a REAL Postgres (migration 0115, ADR-0088), through
 * the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/projects/folder-bin.integration.spec.ts
 *
 * Every rule here is a claim about SQL: which rows a listing leaves out, what
 * the triggers refuse, what the hold predicate covers, which answers the
 * derived-content search finds, what the setting does at read time. The
 * backend (chunk purge, ingest) and the document's object-store steps are
 * stubbed; the rows are real.
 *
 *   Lageplan.pdf                  (project root)
 *   Verwaltung/                   inherits                Protokoll.pdf
 *     Verträge/                   gf: write, bh: read     Vertrag.pdf
 *
 * Who is on a folder's own list is the folder roles WorkOS reports for each
 * membership (ADR-0097), faked here per membership (`om_gf`, `om_bh`, `om_pl`).
 *       Alt/                      inherits                Alt.pdf
 *   Pläne/                        inherits                Plan.pdf
 *     Archiv/                     inherits                Archiv.pdf
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import {
  COLLECTION,
  ORG,
  USER,
  access,
  admin,
  bh,
  bin,
  claimable,
  closeBinFixtures,
  collectionRef,
  db,
  doc,
  docsRepo,
  documentRow,
  documentService,
  folder,
  folderState,
  folders,
  gf,
  ids,
  inOrg,
  inTenant,
  insertDocument,
  insertFolder,
  jobs,
  lifecycle,
  makeDue,
  manager,
  openBinFixtures,
  pl,
  projectId,
  queueRow,
  queuedJobs,
  runRestoreJob,
  seed,
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
vi.mock('@/lib/documents/document-edits', () => ({
  eraseProjectDocument: vi.fn(async (doc: { id: string; organizationId: string; projectId: string }) => {
    const { deleteProjectDocument } = await import('@/lib/documents/repository')
    await deleteProjectDocument(doc.id, doc.organizationId, doc.projectId)
    return true
  }),
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

  describe('deleting a folder puts it, its subfolders and their documents in the bin', () => {
    it('hides them from every listing, every document read and the agent, for everyone, admins included', async () => {
      const result = await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      expect(result).toMatchObject({ documentsBinned: 2, foldersBinned: 2 })

      for (const session of [pl, gf, admin]) {
        expect((await folders.listProjectFolders(projectId, session)).map((row) => row.name)).not.toContain('Pläne')
        expect((await folders.listProjectFolders(projectId, session)).map((row) => row.name)).not.toContain('Archiv')
        expect(await visibleDocumentNames(session)).not.toContain('Plan.pdf')
        expect(await visibleDocumentNames(session)).not.toContain('Archiv.pdf')
        expect(await access.isFolderVisibleTo(session, projectId, folder.officeShelf)).toBe(false)
      }
      expect(await access.getRestrictedFolderIds(ORG, projectId)).toEqual(expect.arrayContaining([folder.plans, folder.officeShelf]))
      expect(await visibleDocumentNames(pl)).toEqual(['Lageplan.pdf', 'Protokoll.pdf'])
    })

    it('hides them in a project where no folder has its own list, too (the probe finds the bin)', async () => {
      await inOrg(() =>
        db.execute(sql`UPDATE project_folders SET access_mode = 'inherit', access_changed_by = NULL, access_changed_at = NULL
                       WHERE project_id = ${projectId}::uuid`)
      )
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      expect(await visibleDocumentNames(pl)).toEqual(['Alt.pdf', 'Lageplan.pdf', 'Protokoll.pdf', 'Vertrag.pdf'])
      expect(await access.isFolderVisibleTo(pl, projectId, folder.plans)).toBe(false)
    })

    it('takes their chunks out of retrieval in the same request, and an ingest still running is told the document is gone', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      const purged = vi.mocked(collectionRef.purgeIngestedChunks).mock.calls.map(([, ref]) => ref.filename).sort()
      expect(purged).toEqual(['Archiv.pdf', 'Plan.pdf'])
      for (const call of vi.mocked(collectionRef.purgeIngestedChunks).mock.calls) expect(call).toHaveLength(3)
      expect(await docsRepo.documentExistsInCollection(doc.plan, COLLECTION, ORG)).toBe(false)
      expect(await docsRepo.documentExistsInCollection(doc.sitePlan, COLLECTION, ORG)).toBe(true)
    })

    it('is undone and refused when the index does not confirm, so it is never in the bin while searchable', async () => {
      vi.mocked(collectionRef.purgeIngestedChunks).mockImplementation(async (_backend, ref) => ref.filename !== 'Archiv.pdf')
      await expect(bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })).rejects.toMatchObject({ status: 502 })
      expect((await folderState(folder.plans))?.deleted_at).toBeNull()
      expect((await folderState(folder.officeShelf))?.deleted_at).toBeNull()
      expect(await visibleDocumentNames(pl)).toContain('Plan.pdf')
      expect((await queueRow(folder.plans))[0]?.status).toBe('restored')
      const [restore] = await queuedJobs('restore_folder_bin')
      expect((await documentRow(doc.plan)).metadata?.bffJobId).toBe(restore.job_id)
      await runRestoreJob(pl, restore.payload)
      expect(vi.mocked(documentService.dispatchDocument).mock.calls.map(([input]) => input.filename).sort()).toEqual([
        'Archiv.pdf',
        'Plan.pdf',
      ])
      expect(await queuedJobs('purge_binned_chunks')).toEqual([])
    })

    it('queues, with the bin entry, the job that finishes the purge, and withdraws it once the request confirmed', async () => {
      let during: Awaited<ReturnType<typeof queuedJobs>> = []
      vi.mocked(collectionRef.purgeIngestedChunks).mockImplementation(async () => {
        if (during.length === 0) during = await queuedJobs('purge_binned_chunks')
        return true
      })
      const before = Date.now()
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      expect(during).toHaveLength(1)
      expect(during[0].priority).toBe(0)
      expect(new Date(String(during[0].not_before)).getTime()).toBeGreaterThanOrEqual(before + bin.BIN_PURGE_TAKEOVER_MS - 5_000)
      expect(during[0].payload).toMatchObject({ projectId, folderId: folder.plans, cursor: null })
      expect(await queuedJobs('purge_binned_chunks')).toEqual([])
      const [entry] = await queueRow(folder.plans)
      expect(entry.payload).toMatchObject({ documents: 2, chunksPurgedAt: expect.any(String) })
    })

    it('is finished by its job when the request died half way, so it is not searchable for the grace period', async () => {
      vi.mocked(collectionRef.purgeIngestedChunks).mockImplementation(async () => {
        throw new Error('the pod went away')
      })
      await expect(bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })).rejects.toThrow(/went away/)
      expect((await folderState(folder.plans))?.deleted_at).not.toBeNull()
      expect((await queueRow(folder.plans))[0]?.payload.chunksPurgedAt).toBeUndefined()

      const [job] = await queuedJobs('purge_binned_chunks')
      vi.mocked(collectionRef.purgeIngestedChunks).mockReset()
      vi.mocked(collectionRef.purgeIngestedChunks).mockResolvedValue(true)
      const result = await jobs.runPurgeBinnedChunksSlice(ORG, job.payload as never, { last: false })
      expect(result.done).toBe(true)
      expect(vi.mocked(collectionRef.purgeIngestedChunks).mock.calls.map(([, ref]) => ref.filename).sort()).toEqual([
        'Archiv.pdf',
        'Plan.pdf',
      ])
      expect((await queueRow(folder.plans))[0]?.payload).toMatchObject({ documents: 2, chunksPurgedAt: expect.any(String) })
      expect((await folderState(folder.plans))?.deleted_at).not.toBeNull()

      vi.mocked(collectionRef.purgeIngestedChunks).mockClear()
      await jobs.runPurgeBinnedChunksSlice(ORG, job.payload as never, { last: false })
      expect(collectionRef.purgeIngestedChunks).not.toHaveBeenCalled()
    })

    it('has its job retry a refused purge, and undo the delete on the last attempt instead of leaving it searchable', async () => {
      vi.mocked(collectionRef.purgeIngestedChunks).mockImplementation(async () => {
        throw new Error('the pod went away')
      })
      await expect(bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })).rejects.toThrow(/went away/)
      const [job] = await queuedJobs('purge_binned_chunks')
      vi.mocked(collectionRef.purgeIngestedChunks).mockReset()
      vi.mocked(collectionRef.purgeIngestedChunks).mockImplementation(async (_backend, ref) => ref.filename !== 'Archiv.pdf')

      await expect(jobs.runPurgeBinnedChunksSlice(ORG, job.payload as never, { last: false })).rejects.toThrow(/did not confirm/)
      expect((await folderState(folder.plans))?.deleted_at).not.toBeNull()

      await expect(jobs.runPurgeBinnedChunksSlice(ORG, job.payload as never, { last: true })).resolves.toMatchObject({ done: true })
      expect((await folderState(folder.plans))?.deleted_at).toBeNull()
      expect((await queueRow(folder.plans))[0]?.status).toBe('restored')
      expect(await queuedJobs('restore_folder_bin')).toHaveLength(1)
    })

    it('has its job do nothing once the folder was restored', async () => {
      vi.mocked(collectionRef.purgeIngestedChunks).mockImplementation(async () => {
        throw new Error('the pod went away')
      })
      await expect(bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })).rejects.toThrow(/went away/)
      const [job] = await queuedJobs('purge_binned_chunks')
      await bin.restoreFolderFromBin(pl, { projectId, folderId: folder.plans })
      vi.mocked(collectionRef.purgeIngestedChunks).mockReset()
      vi.mocked(collectionRef.purgeIngestedChunks).mockResolvedValue(true)
      await expect(jobs.runPurgeBinnedChunksSlice(ORG, job.payload as never, { last: true })).resolves.toMatchObject({ done: true })
      expect(collectionRef.purgeIngestedChunks).not.toHaveBeenCalled()
      expect((await folderState(folder.plans))?.deleted_at).toBeNull()
    })

    it('is never placed back into a collection while it is in the bin', async () => {
      await bin.moveFolderToBin(gf, { projectId, folderId: folder.contracts })
      vi.mocked(collectionRef.purgeIngestedChunks).mockClear()
      const placement = inTenant(await import('./collection-placement'))
      await expect(placement.placeProjectDocuments(ORG, projectId)).resolves.toMatchObject({ moved: 0, failed: [] })
      expect(documentService.dispatchDocument).not.toHaveBeenCalled()
      expect(collectionRef.purgeIngestedChunks).not.toHaveBeenCalled()
    })

    it('queues the purge for FOLDER_PURGE_GRACE_DAYS later, and the purger does not take it before', async () => {
      const before = Date.now()
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      const [row] = await queueRow(folder.plans)
      expect(row.status).toBe('pending')
      expect(row.requested_by).toBe('user_pl')
      expect(new Date(row.purge_after).getTime()).toBeGreaterThanOrEqual(before + 14 * 86_400_000 - 5_000)
      expect(await claimable()).not.toContain(folder.plans)
      await makeDue(folder.plans)
      expect(await claimable()).toContain(folder.plans)
    })
  })

  describe('who may delete what (a subtree the person cannot fully write is refused without naming it)', () => {
    it('refuses a folder holding a subfolder the person may not read, generically, and bins nothing', async () => {
      const refusal = await bin.moveFolderToBin(pl, { projectId, folderId: folder.admin }).catch((error) => error)
      expect(refusal).toMatchObject({ status: 403, details: { reason: bin.FOLDER_CONTENTS_PROTECTED_REASON } })
      expect(String(refusal.message)).not.toMatch(/Vertr|Alt/)
      expect((await folderState(folder.admin))?.deleted_at).toBeNull()
      expect(await queueRow(folder.admin)).toEqual([])
    })

    it('gives the same refusal for a subfolder the person may only read', async () => {
      await expect(bin.moveFolderToBin(bh, { projectId, folderId: folder.admin })).rejects.toMatchObject({
        status: 403,
        details: { reason: bin.FOLDER_CONTENTS_PROTECTED_REASON },
      })
    })

    it('answers a folder the person may only read as read-only, and one they may not read as not found', async () => {
      await expect(bin.moveFolderToBin(bh, { projectId, folderId: folder.contracts })).rejects.toMatchObject({
        status: 403,
        details: { reason: 'folder-read-only' },
      })
      await expect(bin.moveFolderToBin(pl, { projectId, folderId: folder.contracts })).rejects.toMatchObject({ status: 404 })
    })

    it('lets someone who writes the whole subtree delete it, restricted parts included', async () => {
      await expect(bin.moveFolderToBin(gf, { projectId, folderId: folder.admin })).resolves.toMatchObject({
        documentsBinned: 3,
        foldersBinned: 3,
      })
    })
  })

  describe('nothing lands in a deleted folder (the triggers, migration 0115)', () => {
    it('refuses an upload, a move and a new subfolder into a folder in the bin', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await expect(insertDocument('Neu.pdf', folder.officeShelf)).rejects.toMatchObject({ cause: { code: 'GFD01' } })
      await expect(
        inOrg(() => db.execute(sql`UPDATE documents SET folder_id = ${folder.plans}::uuid WHERE id = ${doc.sitePlan}::uuid`))
      ).rejects.toMatchObject({ cause: { code: 'GFD01' } })
      await expect(insertFolder('Neu', folder.plans, 'Pläne/Neu', null)).rejects.toMatchObject({ cause: { code: 'GFD01' } })
    })

    it('makes an upload that started before the delete finish first, and the delete takes it along', async () => {
      let release = (): void => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let insertedId = ''
      const upload = inOrg(() =>
        db.transaction(async (tx) => {
          const rows = await tx.execute<{ id: string }>(sql`
            INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id, folder_id)
            VALUES (${ORG}, ${USER}, 'Spät.pdf', 'k/spaet', ${COLLECTION}, 'completed', 'project', ${projectId}::uuid, ${folder.officeShelf}::uuid)
            RETURNING id`)
          insertedId = ids(rows)[0]
          await gate
        })
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      const deleting = bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await new Promise((resolve) => setTimeout(resolve, 200))
      release()
      await upload
      await expect(deleting).resolves.toMatchObject({ documentsBinned: 3 })
      expect(vi.mocked(collectionRef.purgeIngestedChunks).mock.calls.map(([, ref]) => ref.filename)).toContain('Spät.pdf')
      expect(await access.isFolderVisibleTo(pl, projectId, folder.officeShelf)).toBe(false)
      expect(insertedId).not.toBe('')
    })
  })

  describe('a binned document is not handed to anyone (the download log’s readers all ask the folder rule first)', () => {
    it('refuses every reader, admins included, and a capability URL’s re-check, as not found', async () => {
      const documents = inTenant(await import('@/lib/documents/access'))
      await inOrg(() => db.execute(sql`UPDATE documents SET screening_outcome = 'clean' WHERE id = ${doc.officeShelf}::uuid`))
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      for (const session of [pl, gf, manager, admin]) {
        await expect(documents.getAccessibleDocument(session, doc.officeShelf)).rejects.toMatchObject({ status: 404 })
        await expect(documents.getAccessibleDocument(session, doc.plan, 'write')).rejects.toMatchObject({ status: 404 })
      }
      expect(await access.isFolderVisibleToMember(ORG, projectId, folder.officeShelf, 'user_admin')).toBe(false)
      await bin.restoreFolderFromBin(pl, { projectId, folderId: folder.plans })
      await expect(documents.getAccessibleDocument(pl, doc.officeShelf)).resolves.toMatchObject({ id: doc.officeShelf })
      await expect(documents.getAccessibleDocument(pl, doc.plan)).rejects.toMatchObject({ status: 404 })
      await expect(documents.getAccessibleDocument(manager, doc.plan)).resolves.toMatchObject({ id: doc.plan })
      await inOrg(() => db.execute(sql`UPDATE documents SET status = 'completed' WHERE id = ${doc.plan}::uuid`))
      await expect(documents.getAccessibleDocument(pl, doc.plan)).resolves.toMatchObject({ id: doc.plan })
    })
  })

  describe('a claim is a token: a holder whose claim was taken over changes nothing', () => {
    type Claim = { id: string; entity_id: string; claim_token: string }

    async function asPurger<T>(run: (client: never, queue: typeof import('../../purger/db.js')) => Promise<T>): Promise<T> {
      const queue = await import('../../purger/db.js')
      const client = postgres(url as string, { prepare: false, max: 1 })
      try {
        return await run(client as never, queue)
      } finally {
        await client.end()
      }
    }

    async function purgerClaims(folderId: string): Promise<Claim> {
      const entry = await asPurger((client, queue) =>
        (client as unknown as ReturnType<typeof postgres>).begin(async (tx) => {
          await tx.unsafe('SET LOCAL ROLE app_platform')
          return (await queue.claimNext(tx as never)) as unknown as Claim | null
        })
      )
      expect(entry?.entity_id).toBe(folderId)
      return entry as Claim
    }

    async function setRow(folderId: string, set: ReturnType<typeof sql>): Promise<void> {
      await withPlatformAccess('test: age or move the queue row', () =>
        db.execute(sql`UPDATE deletion_queue SET ${set} WHERE entity_type = 'folder' AND entity_id = ${folderId}`)
      )
    }
    const statusOf = async (folderId: string) => (await queueRow(folderId))[0].status
    const giveUpOn = (folderId: string) =>
      setRow(folderId, sql`status = 'failed', attempts = 10, claimed_at = now() - interval '2 hours', purge_after = now() - interval '1 day'`)
    async function attemptsOf(folderId: string): Promise<{ status: string; attempts: number }> {
      const [row] = await withPlatformAccess('test: read the attempts', () =>
        db.execute<{ status: string; attempts: number }>(sql`
          SELECT status, attempts FROM deletion_queue WHERE entity_type = 'folder' AND entity_id = ${folderId}`)
      )
      return { status: row.status, attempts: Number(row.attempts) }
    }

    it('every claim writes a new token, the takeover of a stale claim included', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await setRow(folder.plans, sql`purge_after = now() - interval '1 minute'`)

      const first = await purgerClaims(folder.plans)
      await setRow(folder.plans, sql`claimed_at = now() - interval '16 minutes'`)
      const second = await purgerClaims(folder.plans)

      expect(first.claim_token).toMatch(/^\d{4}-\d{2}-\d{2} /)
      expect(second.claim_token).not.toBe(first.claim_token)

      await asPurger(async (client, queue) => {
        await queue.markFailed(client, first, 'folder purge answered 502')
        await queue.markFailedPermanent(client, first, 'not in the bin')
        await queue.releaseHeld(client, first)
        await (client as unknown as ReturnType<typeof postgres>).begin(async (tx) => {
          await tx.unsafe('SET LOCAL ROLE app_platform')
          await queue.markPurged(tx as never, first)
        })
      })
      expect(await statusOf(folder.plans)).toBe('purging')

      await asPurger((client, queue) =>
        (client as unknown as ReturnType<typeof postgres>).begin(async (tx) => {
          await tx.unsafe('SET LOCAL ROLE app_platform')
          await queue.markPurged(tx as never, second)
        })
      )
      expect(await statusOf(folder.plans)).toBe('purged')
    })

    it('a request that fails after the purger took its claim over and purged does not fail the row of the erased folder', async () => {
      const edits = await import('@/lib/documents/document-edits')
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await setRow(folder.plans, sql`attempts = 8`)
      let purger: Claim | undefined
      const erase = vi.mocked(edits.eraseProjectDocument).getMockImplementation()
      vi.mocked(edits.eraseProjectDocument).mockImplementationOnce(async () => {
        await setRow(folder.plans, sql`claimed_at = now() - interval '16 minutes'`)
        purger = await purgerClaims(folder.plans)
        throw new Error('object store down')
      })

      await expect(bin.purgeFolderFromBinNow(manager, { projectId, folderId: folder.plans })).rejects.toThrow('object store down')
      expect(await attemptsOf(folder.plans)).toEqual({ status: 'purging', attempts: 10 })

      vi.mocked(edits.eraseProjectDocument).mockImplementation(erase!)
      await inOrg(() => bin.purgeBinnedFolder(ORG, folder.plans))
      await asPurger((client, queue) =>
        (client as unknown as ReturnType<typeof postgres>).begin(async (tx) => {
          await tx.unsafe('SET LOCAL ROLE app_platform')
          await queue.markPurged(tx as never, purger as Claim)
        })
      )

      expect(await statusOf(folder.plans)).toBe('purged')
    })

    it('a request on the last attempt that the reap failed while it still ran closes its own row when it finishes', async () => {
      const edits = await import('@/lib/documents/document-edits')
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await giveUpOn(folder.plans)
      const erase = vi.mocked(edits.eraseProjectDocument).getMockImplementation()
      vi.mocked(edits.eraseProjectDocument).mockImplementationOnce(async (...args) => {
        await setRow(folder.plans, sql`status = 'failed', last_error = 'stranded in purging after max attempts (presumed purger crash)'`)
        return erase!(...args)
      })

      await expect(bin.purgeFolderFromBinNow(manager, { projectId, folderId: folder.plans })).resolves.toMatchObject({ status: 'purged' })

      expect(await statusOf(folder.plans)).toBe('purged')
    })

    describe('a row that reads failed, or would be reaped, for a folder the BFF provably purged', () => {
      async function purgedButNotClosed(set: ReturnType<typeof sql>): Promise<void> {
        await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
        await inOrg(() => bin.purgeBinnedFolder(ORG, folder.plans))
        await setRow(folder.plans, set)
      }
      const stranded = sql`status = 'purging', attempts = 10, claimed_at = now() - interval '16 minutes'`

      it('is closed purged before the reap would fail it', async () => {
        await purgedButNotClosed(stranded)

        const counts = await asPurger(async (client, queue) => [await queue.closeErased(client), await queue.reapStranded(client)])

        expect(counts).toEqual([1, 0])
        expect(await statusOf(folder.plans)).toBe('purged')
      })

      it('is closed purged when the failed attempt was recorded as failed', async () => {
        await purgedButNotClosed(sql`status = 'failed', attempts = 10, last_error = 'the database system is shutting down'`)

        expect(await asPurger((client, queue) => queue.closeErased(client))).toBe(1)
        expect(await statusOf(folder.plans)).toBe('purged')
      })

      it('stays failed while the removal still owes traces: that cannot be told from the database', async () => {
        await purgedButNotClosed(sql`status = 'purging', attempts = 10, claimed_at = now() - interval '16 minutes',
          payload = coalesce(payload, '{}'::jsonb) || '{"derivedRemoval": {"removedAt": "2026-11-11T00:00:00.000Z", "conversationIds": ["s_owed"]}}'::jsonb`)

        const counts = await asPurger(async (client, queue) => [await queue.closeErased(client), await queue.reapStranded(client)])

        expect(counts).toEqual([0, 1])
        expect(await statusOf(folder.plans)).toBe('failed')
      })

      it('leaves a stranded row whose folder is not purged to the reap, and a live final attempt alone', async () => {
        await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
        await setRow(folder.plans, sql`status = 'purging', attempts = 10, claimed_at = now() - interval '1 minute'`)
        expect(await asPurger((client, queue) => queue.closeErased(client))).toBe(0)
        expect(await statusOf(folder.plans)).toBe('purging')

        await setRow(folder.plans, stranded)
        const counts = await asPurger(async (client, queue) => [await queue.closeErased(client), await queue.reapStranded(client)])
        expect(counts).toEqual([0, 1])
        expect(await statusOf(folder.plans)).toBe('failed')
      })
    })
  })
})

/**
 * @vitest-environment node
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  BH,
  CHAT,
  COLLECTION,
  GF,
  ORG,
  PROJECT_WRITE,
  USER,
  access,
  admin,
  bin,
  claimable,
  closeBinFixtures,
  collectionRef,
  db,
  doc,
  documentService,
  folder,
  folderState,
  gf,
  hold,
  ids,
  inOrg,
  insertAnswer,
  insertNote,
  levelsOf,
  lifecycle,
  makeDue,
  manager,
  memory,
  message,
  openBinFixtures,
  pl,
  projectId,
  queueRow,
  releaseHolds,
  restrictedUse,
  seed,
  sessionOf,
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

  describe('the purge', () => {
    it('erases the documents, keeps the folders as tombstones with their lists, and marks what was derived', async () => {
      const cites = await insertAnswer('Laut Plan.pdf ist …', [{ collection: COLLECTION, file_name: 'Plan.pdf', title: 'Plan' }])
      const other = await insertAnswer('Laut Lageplan.pdf …', [{ collection: COLLECTION, file_name: 'Lageplan.pdf' }])
      await bin.moveFolderToBin(gf, { projectId, folderId: folder.plans })
      await makeDue(folder.plans)

      const result = await bin.purgeBinnedFolder(ORG, folder.plans)
      expect(result).toMatchObject({ status: 'purged', counts: { documents: 2, folders: 2, answers: 1, conversations: 1 } })
      expect(result.traceConversationIds).toEqual([])
      const remaining = await inOrg(() => db.execute<{ id: string }>(sql`SELECT id FROM documents WHERE organization_id = ${ORG}`))
      expect(ids(remaining)).not.toEqual(expect.arrayContaining([doc.plan]))
      expect(ids(remaining)).not.toContain(doc.officeShelf)
      expect((await folderState(folder.plans))?.purged_at).not.toBeNull()
      expect((await folderState(folder.officeShelf))?.purged_at).not.toBeNull()
      const [marked] = await inOrg(() =>
        db.execute<{ metadata: Record<string, unknown>; content: string }>(sql`SELECT metadata, content FROM messages WHERE id = ${cites}::uuid`)
      )
      expect(marked.metadata.sourceDeleted).toMatchObject({ folderId: folder.plans })
      expect(marked.content).toBe('Laut Plan.pdf ist …')
      const [untouched] = await inOrg(() =>
        db.execute<{ metadata: Record<string, unknown> }>(sql`SELECT metadata FROM messages WHERE id = ${other}::uuid`)
      )
      expect(untouched.metadata.sourceDeleted).toBeUndefined()
      expect(await restrictedUse.recordedRestrictedFolders(CHAT, ORG)).toEqual([])
    })

    it('keeps a purged restricted folder’s own list, which still decides who reads what came from it', async () => {
      await bin.moveFolderToBin(gf, { projectId, folderId: folder.contracts })
      await makeDue(folder.contracts)
      await bin.purgeBinnedFolder(ORG, folder.contracts)
      const [row] = await inOrg(() =>
        db.execute<{ access_mode: string; everyone_reads: boolean }>(
          sql`SELECT access_mode, everyone_reads FROM project_folders WHERE id = ${folder.contracts}::uuid`
        )
      )
      expect(row).toMatchObject({ access_mode: 'custom', everyone_reads: false })
      const holder = { levels: levelsOf(BH), seesEverything: false }
      expect(await access.readableFolderIdsFor(ORG, projectId, holder)).toContain(folder.contracts)
      expect(await access.readableFolderIdsFor(ORG, projectId, access.ANY_MEMBER)).not.toContain(folder.contracts)
    })

    it('is idempotent: a second run finds it purged and does nothing', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await bin.purgeBinnedFolder(ORG, folder.plans)
      await expect(bin.purgeBinnedFolder(ORG, folder.plans)).resolves.toMatchObject({ status: 'already-purged' })
    })

    it('„Endgültig löschen" purges at once for a project admin and closes the record', async () => {
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await expect(bin.purgeFolderFromBinNow(pl, { projectId, folderId: folder.plans })).rejects.toMatchObject({ status: 404 })
      const result = await bin.purgeFolderFromBinNow(manager, { projectId, folderId: folder.plans })
      expect(result.counts.documents).toBe(2)
      const [row] = await queueRow(folder.plans)
      expect(row.status).toBe('purged')
      expect(row.payload.purged).toMatchObject({ documents: 2, folders: 2 })
    })
  })

  describe('a legal hold blocks the purge and the erasure', () => {
    it.each([
      ['the folder', () => ['folder', folder.contracts]],
      ['a folder above it', () => ['folder', folder.admin]],
      ['a document in it', () => ['document', doc.old]],
      ['the project', () => ['project', projectId]],
      ['the custodian of a document in it', () => ['user', 'user_custodian']],
      ['the organization', () => ['organization', ORG]],
    ] as const)('covers a folder through a hold on %s', async (_label, target) => {
      const [entityType, entityId] = target()
      await hold(entityType, entityId)
      const [covered] = await inOrg(() =>
        db.execute<{ held: boolean }>(sql`SELECT legal_hold_blocks('folder', ${folder.contracts}, ${ORG}) AS held`)
      )
      expect(covered.held).toBe(true)
    })

    it('does not cover a folder for a hold elsewhere in the project', async () => {
      await hold('document', doc.plan)
      const [covered] = await inOrg(() =>
        db.execute<{ held: boolean }>(sql`SELECT legal_hold_blocks('folder', ${folder.contracts}, ${ORG}) AS held`)
      )
      expect(covered.held).toBe(false)
    })

    it('covers a document through a hold on a folder above it, and a project through a hold on one of its folders', async () => {
      await hold('folder', folder.admin)
      const [document] = await inOrg(() =>
        db.execute<{ held: boolean }>(sql`SELECT legal_hold_blocks('document', ${doc.old}, ${ORG}) AS held`)
      )
      const [project] = await inOrg(() =>
        db.execute<{ held: boolean }>(sql`SELECT legal_hold_blocks('project', ${projectId}, ${ORG}) AS held`)
      )
      expect([document.held, project.held]).toEqual([true, true])
    })

    it('keeps the purger from claiming, and refuses the purge and „Endgültig löschen" with 409', async () => {
      await bin.moveFolderToBin(gf, { projectId, folderId: folder.contracts })
      await makeDue(folder.contracts)
      await hold('document', doc.contract)
      expect(await claimable()).not.toContain(folder.contracts)
      const held = { status: 409, details: { reason: 'legal_hold' } }
      await expect(bin.purgeBinnedFolder(ORG, folder.contracts)).rejects.toMatchObject(held)
      await expect(bin.purgeFolderFromBinNow(sessionOf('user_mgr', GF, [...PROJECT_WRITE, 'project:manage']), { projectId, folderId: folder.contracts })).rejects.toMatchObject(held)
      const refusal = await bin.purgeBinnedFolder(ORG, folder.contracts).catch((error) => error)
      expect(JSON.stringify(refusal.details)).not.toContain('integration test')
      const left = await inOrg(() => db.execute<{ id: string }>(sql`SELECT id FROM documents WHERE id = ${doc.contract}::uuid`))
      expect(ids(left)).toEqual([doc.contract])
      await releaseHolds()
      expect(await claimable()).toContain(folder.contracts)
    })
  })

  describe('„Mit dem Ordner entfernen“ when „Endgültig löschen“ runs: everything derived goes, the traces by the purger', () => {
    const langfuse = vi.fn(async () => Response.json({ data: [], meta: {} }))

    beforeEach(async () => {
      await setting.saveDeletedFolderContentPolicy(admin, 'remove', new Request('http://test'))
      vi.stubEnv('LANGFUSE_HOST', 'http://langfuse.test')
      vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk')
      vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk') // pragma: allowlist secret (a stub Langfuse)
      langfuse.mockClear()
      vi.stubGlobal('fetch', langfuse)
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    })

    it('hands the traces to the purger with its attempts started over, also when a person retried a row the purger gave up on', async () => {
      message.cites = await insertAnswer('Laut Plan.pdf …', [{ collection: COLLECTION, file_name: 'Archiv.pdf' }])
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })
      await withPlatformAccess('test: the purger gave up', () =>
        db.execute(sql`UPDATE deletion_queue SET status = 'failed', attempts = 10, claimed_at = now() - interval '2 hours'
                       WHERE entity_type = 'folder' AND entity_id = ${folder.plans}`)
      )

      const result = await bin.purgeFolderFromBinNow(manager, { projectId, folderId: folder.plans }, new Request('http://test'))

      expect(result.traceConversationIds).toEqual([CHAT])
      expect((await queueRow(folder.plans))[0].status).toBe('pending')
      expect(await claimable()).toContain(folder.plans)
    })

    it('deletes the notes, replaces the answers, marks the reports, records ids without content, and hands the traces to the purger', async () => {
      memory.restricted = await insertNote('aus dem Plan', [folder.plans], null)
      memory.fromChat = await insertNote('im Chat gelernt', null, CHAT)
      memory.unrelated = await insertNote('anderes Projektwissen', null, null)
      message.cites = await insertAnswer('Laut Plan.pdf hat Herr Muster …', [
        { collection: COLLECTION, file_name: 'Archiv.pdf', content: 'Herr Muster, geb. 1970' },
      ])
      message.other = await insertAnswer('Allgemein …', [{ collection: COLLECTION, file_name: 'Lageplan.pdf' }])
      const [report] = ids(
        await inOrg(() =>
          db.execute<{ id: string }>(sql`
            INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id,
                                   authored_by, authored_by_producer, authored_by_ref, authored_by_ref_kind)
            VALUES (${ORG}, ${USER}, 'piloti/bericht.pdf', 'k/bericht', ${COLLECTION}, 'completed', 'project', ${projectId}::uuid,
                    'agent', 'report', ${message.cites}, 'answer_artifact')
            RETURNING id`)
        )
      )
      await bin.moveFolderToBin(pl, { projectId, folderId: folder.plans })

      const result = await bin.purgeFolderFromBinNow(manager, { projectId, folderId: folder.plans }, new Request('http://test'))

      expect(result.counts).toMatchObject({ documents: 2, folders: 2, memoryNotes: 2, answers: 1, conversations: 1, reports: 1, tracesErased: 0 })
      const notes = await inOrg(() => db.execute<{ id: string }>(sql`SELECT id FROM project_memory WHERE organization_id = ${ORG}`))
      expect(ids(notes)).toEqual([memory.unrelated])
      const [answer] = await inOrg(() =>
        db.execute<{ content: string; metadata: Record<string, unknown> }>(sql`SELECT content, metadata FROM messages WHERE id = ${message.cites}::uuid`)
      )
      expect(answer.content).toBe('Inhalt entfernt: Quelle gelöscht')
      expect(Object.keys(answer.metadata)).toEqual(['sourceRemoved'])
      const [other] = await inOrg(() => db.execute<{ content: string }>(sql`SELECT content FROM messages WHERE id = ${message.other}::uuid`))
      expect(other.content).toBe('Allgemein …')
      expect(langfuse).not.toHaveBeenCalled()
      const [kept] = await inOrg(() =>
        db.execute<{ metadata: Record<string, unknown> }>(sql`SELECT metadata FROM documents WHERE id = ${report}::uuid`)
      )
      expect(kept.metadata.sourceDeleted).toMatchObject({ folderId: folder.plans })

      const [record] = await queueRow(folder.plans)
      expect(record.status).toBe('pending')
      expect(await claimable()).toContain(folder.plans)
      expect((await bin.listFolderBin(manager, projectId)).entries).toEqual([])
      expect(record.requested_by).toBe('user_pl')
      expect(record.payload.derivedRemoval).toMatchObject({
        conversationIds: [CHAT],
        messageIds: [message.cites],
        reportIds: [report],
      })
      expect(record.payload.purged).toMatchObject({ tracesErased: 0, memoryNotes: 2 })
      const proof = JSON.stringify(record.payload)
      for (const content of ['Herr Muster', 'Plan.pdf', 'Archiv.pdf', 'aus dem Plan']) expect(proof).not.toContain(content)

      await expect(bin.purgeBinnedFolder(ORG, folder.plans)).resolves.toMatchObject({
        status: 'already-purged',
        counts: { documents: 2, memoryNotes: 2 },
        traceConversationIds: [CHAT],
      })
    })
  })
})

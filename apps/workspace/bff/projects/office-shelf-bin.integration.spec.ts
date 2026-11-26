/**
 * @vitest-environment node
 *
 * The Bürobibliothek's own Papierkorb (migration 0264, ADR-0195) against a REAL
 * Postgres, through the restricted runtime role: the project bin's code over the
 * office shelf. The backend (chunk purge, ingest) and a document's object-store
 * steps are stubbed; the rows, the triggers and the hold predicate are real.
 *
 *   Lose.pdf                      (office shelf root)
 *   Leitfäden/                    Leitfaden.pdf
 *     Brandschutz/                Brandschutz.pdf
 *   Grundlagen des Büros/         (Normen & Richtlinien)
 *     Akustik/                    ÖNORM B 8115.pdf
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { ORG, USER, claimable, db, ids, inOrg, makeDue, queueRow, queuedJobs, url, withPlatformAccess } from './folder-bin.fixtures'
import { OFFICE_SHELF, projectShelf } from '@/lib/documents/shelf'
import { REVIEWER_READER } from '@/lib/documents/document-reader'
import { officeShelfCollectionName } from '@/lib/office-shelf/collection'
import { STANDARDS_FOLDER_NAME } from '@/lib/office-shelf/standards-folder'
import type { AuthorizedSession } from '@/lib/auth/types'

const norms = vi.hoisted(() => ({ listed: new Set<string>() }))

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
  eraseShelfDocument: vi.fn(async (doc: { id: string; organizationId: string }) => {
    const { deleteShelfDocumentRow } = await import('@/lib/documents/repository')
    const { OFFICE_SHELF: office } = await import('@/lib/documents/shelf')
    await deleteShelfDocumentRow(doc.id, doc.organizationId, office)
    return true
  }),
}))
vi.mock('@/lib/documents/ingest-dispatch', () => ({ INGEST_DISPATCH_FAILED_MESSAGE: 'dispatch failed' }))
vi.mock('@/lib/documents/lifecycle', () => ({
  redispatchPublishedVersion: vi.fn(async () => ({ jobId: 'job', status: 'pending' })),
}))
vi.mock('@/lib/base-knowledge/store/repository', () => ({
  entryIdsForDocuments: vi.fn(async (_org: string, documentIds: readonly string[]) =>
    new Map(documentIds.filter((id) => norms.listed.has(id)).map((id) => [id, `entry-${id}`]))
  ),
}))

const session = (userId: string, permissions: string[]): AuthorizedSession =>
  ({
    userId,
    organizationId: ORG,
    organizationMembershipId: null,
    email: `${userId}@example.test`,
    role: 'member',
    roles: ['member'],
    permissions,
  }) as unknown as AuthorizedSession

const curator = session('user_curator', ['org:office_shelf:manage'])
const member = session('user_member', [])
const COLLECTION = officeShelfCollectionName(ORG)
const folder: Record<string, string> = {}
const doc: Record<string, string> = {}

let bin: typeof import('./folder-bin')
let documentBin: typeof import('./document-bin')
let jobs: typeof import('./folder-bin-jobs')
let officeFolders: typeof import('@/lib/office-shelf/folder-service')
let access: typeof import('@/lib/documents/access')
let docsRepo: typeof import('@/lib/documents/repository')
let audit: typeof import('@/lib/audit/service')
let chunks: typeof import('@/lib/documents/collection-file-ref')
let dispatch: typeof import('@/lib/documents/document-dispatch')
let edits: typeof import('@/lib/documents/document-edits')
let repository: typeof import('./folder-bin-repository')

function inTenant<M extends object>(module: M): M {
  return new Proxy(module, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => inOrg(async () => (value as (...input: unknown[]) => unknown)(...args))
    },
  })
}

async function insertFolder(name: string, parentId: string | null, path: string): Promise<string> {
  const [id] = ids(
    await inOrg(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO project_folders (organization_id, scope, parent_id, name, path)
        VALUES (${ORG}, 'office_shelf', ${parentId}::uuid, ${name}, ${path}) RETURNING id`)
    )
  )
  return id
}

async function insertDocument(filename: string, folderId: string | null): Promise<string> {
  const [id] = ids(
    await inOrg(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, folder_id)
        VALUES (${ORG}, ${USER}, ${filename}, ${`k/${filename}`}, ${COLLECTION}, 'completed', 'office_shelf', ${folderId}::uuid)
        RETURNING id`)
    )
  )
  return id
}

async function folderRow(folderId: string) {
  const [row] = await inOrg(() =>
    db.execute<{ deleted_at: string | null; purged_at: string | null; bin_root_id: string | null; parent_id: string | null; path: string }>(
      sql`SELECT deleted_at, purged_at, bin_root_id, parent_id, path FROM project_folders WHERE id = ${folderId}::uuid`
    )
  )
  return row
}

async function documentRow(documentId: string) {
  const [row] = await inOrg(() =>
    db.execute<{ status: string; folder_id: string | null }>(sql`SELECT status, folder_id FROM documents WHERE id = ${documentId}::uuid`)
  )
  return row
}

async function shelfNames(): Promise<string[]> {
  const rows = await docsRepo.findDocumentsByFilenames(OFFICE_SHELF, ORG, ['Lose.pdf', 'Leitfaden.pdf', 'Brandschutz.pdf'], {
    reader: REVIEWER_READER,
  })
  return rows.map((row) => row.filename).sort()
}

async function hold(entityType: string, entityId: string): Promise<void> {
  await inOrg(() =>
    db.execute(sql`INSERT INTO legal_holds (entity_type, entity_id, organization_id, reason, created_by)
                   VALUES (${entityType}, ${entityId}, ${ORG}, 'integration test', ${USER})`)
  )
}

async function wipeOfficeShelf(): Promise<void> {
  await withPlatformAccess('test: clean up the office shelf bin', async () => {
    await db.execute(sql`UPDATE legal_holds SET released_at = now() WHERE organization_id = ${ORG} AND released_at IS NULL`)
    await db.execute(sql`DELETE FROM legal_holds WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM deletion_queue WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM bff_job_queue WHERE lane = ${ORG}`)
    await db.execute(sql`DELETE FROM documents WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM project_folders WHERE organization_id = ${ORG}`)
  })
}

const legalHold = { status: 409, details: { reason: 'legal_hold' } }
const purgedChunkFiles = () =>
  vi.mocked(chunks.purgeIngestedChunks).mock.calls.map(([, ref]) => (ref as { filename: string }).filename).sort()

describe('the office shelf bin suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('the Bürobibliothek’s Papierkorb against live Postgres (migration 0264)', () => {
  beforeAll(async () => {
    const fixtures = await import('./folder-bin.fixtures')
    await fixtures.openBinFixtures()
    bin = inTenant(await import('./folder-bin'))
    documentBin = inTenant(await import('./document-bin'))
    jobs = inTenant(await import('./folder-bin-jobs'))
    officeFolders = inTenant(await import('@/lib/office-shelf/folder-service'))
    access = inTenant(await import('@/lib/documents/access'))
    docsRepo = inTenant(await import('@/lib/documents/repository'))
    audit = await import('@/lib/audit/service')
    chunks = await import('@/lib/documents/collection-file-ref')
    dispatch = await import('@/lib/documents/document-dispatch')
    edits = await import('@/lib/documents/document-edits')
    repository = await import('./folder-bin-repository')
  })

  beforeEach(async () => {
    await wipeOfficeShelf()
    norms.listed.clear()
    folder.guides = await insertFolder('Leitfäden', null, 'Leitfäden')
    folder.fire = await insertFolder('Brandschutz', folder.guides, 'Leitfäden/Brandschutz')
    folder.standards = await insertFolder(STANDARDS_FOLDER_NAME, null, STANDARDS_FOLDER_NAME)
    folder.topic = await insertFolder('Akustik', folder.standards, `${STANDARDS_FOLDER_NAME}/Akustik`)
    doc.loose = await insertDocument('Lose.pdf', null)
    doc.guide = await insertDocument('Leitfaden.pdf', folder.guides)
    doc.fire = await insertDocument('Brandschutz.pdf', folder.fire)
    doc.norm = await insertDocument('ÖNORM B 8115.pdf', folder.topic)
    vi.mocked(chunks.purgeIngestedChunks).mockReset()
    vi.mocked(chunks.purgeIngestedChunks).mockResolvedValue(true)
    vi.mocked(dispatch.dispatchDocument).mockClear()
    vi.mocked(audit.recordAuditEvent).mockClear()
    vi.mocked(edits.eraseShelfDocument).mockClear()
  })

  afterAll(async () => {
    await wipeOfficeShelf()
    const fixtures = await import('./folder-bin.fixtures')
    await fixtures.closeBinFixtures()
  })

  describe('deleting a folder puts it, its subfolders and their documents in the office shelf’s bin', () => {
    it('marks the subtree, queues the purge for 14 days, takes the chunks out of the index and audits it', async () => {
      const before = Date.now()
      const result = await officeFolders.deleteOfficeShelfFolder(curator, folder.guides, new Request('http://test'))

      expect(result).toMatchObject({ ok: true, result: { documentsBinned: 2, foldersBinned: 2 } })
      expect(await folderRow(folder.guides)).toMatchObject({ bin_root_id: folder.guides, purged_at: null })
      expect(await folderRow(folder.fire)).toMatchObject({ bin_root_id: folder.guides })
      const [entry] = await queueRow(folder.guides)
      expect(entry).toMatchObject({ status: 'pending', requested_by: 'user_curator' })
      expect(entry.payload).toMatchObject({ projectId: null, documents: 2 })
      const days = (new Date(entry.purge_after).getTime() - before) / 86_400_000
      expect(days).toBeGreaterThan(13.9)
      expect(days).toBeLessThan(14.1)
      expect(purgedChunkFiles()).toEqual(['Brandschutz.pdf', 'Leitfaden.pdf'])
      expect(vi.mocked(chunks.purgeIngestedChunks).mock.calls.every(([, ref]) => (ref as { collectionName: string }).collectionName === COLLECTION)).toBe(true)
      expect(audit.recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'office_shelf.folder.binned', targetType: 'organization', targetId: ORG })
      )
    })

    it('hides what it held from the shelf’s listings and document reads, for curators too', async () => {
      expect(await shelfNames()).toEqual(['Brandschutz.pdf', 'Leitfaden.pdf', 'Lose.pdf'])
      await bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })

      expect(await shelfNames()).toEqual(['Lose.pdf'])
      await expect(access.getAccessibleDocument(curator, doc.guide)).rejects.toMatchObject({ status: 404 })
      await expect(access.getAccessibleDocument(member, doc.fire)).rejects.toMatchObject({ status: 404 })
      await expect(access.getAccessibleDocument(member, doc.loose)).resolves.toMatchObject({ id: doc.loose })
    })

    it('lists the entry in the office shelf’s bin for every member, restorable only by a curator, and never in a project’s', async () => {
      await bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })

      const forCurator = await bin.listFolderBin(curator, OFFICE_SHELF)
      expect(forCurator.canPurge).toBe(true)
      expect(forCurator.entries).toEqual([
        expect.objectContaining({ folderId: folder.guides, documents: 2, folders: 2, canRestore: true, restoreBlocked: null, document: null }),
      ])
      const forMember = await bin.listFolderBin(member, OFFICE_SHELF)
      expect(forMember.canPurge).toBe(false)
      expect(forMember.entries).toEqual([expect.objectContaining({ folderId: folder.guides, canRestore: false, restoreBlocked: 'no_write' })])
      const fixtures = await import('./folder-bin.fixtures')
      const page = await inOrg(() => repository.listBinEntries(ORG, projectShelf(fixtures.projectId), REVIEWER_READER, { limit: 50 }))
      expect(page.rows).toEqual([])
    })

    it('refuses filing into the binned folder, under the office shelf’s bin lock (GFD01)', async () => {
      await bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })
      await expect(insertDocument('Neu.pdf', folder.fire)).rejects.toMatchObject({ cause: { code: 'GFD01' } })
      await expect(insertFolder('Neu', folder.guides, 'Leitfäden/Neu')).rejects.toMatchObject({ cause: { code: 'GFD01' } })
    })

    it('undoes the delete when the index does not confirm the chunk purge (502)', async () => {
      vi.mocked(chunks.purgeIngestedChunks).mockResolvedValue(false)
      await expect(bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })).rejects.toMatchObject({ status: 502 })
      expect((await folderRow(folder.guides))?.deleted_at).toBeNull()
      expect(await shelfNames()).toEqual(['Brandschutz.pdf', 'Leitfaden.pdf', 'Lose.pdf'])
    })
  })

  describe('who may', () => {
    it('lets only a curator delete, restore and purge', async () => {
      await expect(bin.moveFolderToBin(member, { shelf: OFFICE_SHELF, folderId: folder.guides })).rejects.toMatchObject({ status: 403 })
      await expect(documentBin.moveDocumentToBin(member, doc.loose)).rejects.toMatchObject({ status: 403 })
      expect((await folderRow(folder.guides))?.deleted_at).toBeNull()

      await bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })
      await expect(bin.restoreFolderFromBin(member, { shelf: OFFICE_SHELF, folderId: folder.guides })).rejects.toMatchObject({ status: 403 })
      await expect(bin.purgeFolderFromBinNow(member, { shelf: OFFICE_SHELF, folderId: folder.guides })).rejects.toMatchObject({ status: 403 })
      expect((await queueRow(folder.guides))[0].status).toBe('pending')
    })

    it('does not reach an office shelf folder through a project’s bin', async () => {
      const fixtures = await import('./folder-bin.fixtures')
      expect(await inOrg(() => repository.findFolderInOrg(db, projectShelf(fixtures.projectId), ORG, folder.guides))).toBeNull()
      expect(await inOrg(() => repository.findFolderInOrg(db, OFFICE_SHELF, ORG, folder.guides))).toMatchObject({ shelf: OFFICE_SHELF })
    })
  })

  describe('a legal hold', () => {
    it('refuses binning a held folder, or a folder holding a held document, and moves nothing', async () => {
      await hold('folder', folder.fire)
      await expect(bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })).rejects.toMatchObject(legalHold)
      expect((await folderRow(folder.guides))?.deleted_at).toBeNull()
      expect(await queueRow(folder.guides)).toEqual([])
      expect(chunks.purgeIngestedChunks).not.toHaveBeenCalled()
    })

    it('refuses binning a held document, before any holder folder is made', async () => {
      await hold('document', doc.loose)
      await expect(documentBin.moveDocumentToBin(curator, doc.loose)).rejects.toMatchObject(legalHold)
      expect(await documentRow(doc.loose)).toMatchObject({ folder_id: null })
      const [{ folders }] = await inOrg(() =>
        db.execute<{ folders: number }>(sql`SELECT count(*)::int AS folders FROM project_folders WHERE organization_id = ${ORG}`)
      )
      expect(folders).toBe(4)
    })

    it('placed after the delete, keeps the purger off the entry and refuses the purge before any erase', async () => {
      await bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })
      await makeDue(folder.guides)
      expect(await claimable()).toContain(folder.guides)

      await hold('document', doc.fire)
      expect(await claimable()).not.toContain(folder.guides)
      await expect(bin.purgeBinnedFolder(ORG, folder.guides)).rejects.toMatchObject(legalHold)
      await expect(bin.purgeFolderFromBinNow(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })).rejects.toMatchObject(legalHold)
      expect(edits.eraseShelfDocument).not.toHaveBeenCalled()
      expect(await documentRow(doc.fire)).toBeTruthy()
    })
  })

  describe('restoring', () => {
    it('puts the folder back where it was, reads its documents again into the office shelf’s collection and audits it', async () => {
      await bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })
      const restored = await bin.restoreFolderFromBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })

      expect(restored).toEqual({ restoredTo: 'original', folders: 2, documents: 2 })
      expect(await folderRow(folder.fire)).toMatchObject({ deleted_at: null, bin_root_id: null, path: 'Leitfäden/Brandschutz' })
      expect((await queueRow(folder.guides))[0].status).toBe('restored')
      expect(await documentRow(doc.guide)).toMatchObject({ status: 'processing' })
      const [job] = await queuedJobs('restore_folder_bin')
      expect(job.payload).toMatchObject({ projectId: null, folderId: folder.guides })

      await jobs.runRestoreFolderSlice(curator, job.payload as Parameters<typeof jobs.runRestoreFolderSlice>[1])
      expect(vi.mocked(dispatch.dispatchDocument).mock.calls.map(([input]) => [input.filename, input.collectionName, input.projectId]).sort()).toEqual([
        ['Brandschutz.pdf', COLLECTION, null],
        ['Leitfaden.pdf', COLLECTION, null],
      ])
      expect(await shelfNames()).toEqual(['Brandschutz.pdf', 'Leitfaden.pdf', 'Lose.pdf'])
      expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'office_shelf.folder.restored' }))
    })

    it('stops a restore job whose requester lost the curator’s right, re-dispatching nothing', async () => {
      await bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })
      await bin.restoreFolderFromBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })
      const [job] = await queuedJobs('restore_folder_bin')
      await jobs.runRestoreFolderSlice(member, job.payload as Parameters<typeof jobs.runRestoreFolderSlice>[1])
      expect(dispatch.dispatchDocument).not.toHaveBeenCalled()
    })

    it('puts a subfolder whose parent is gone at the root', async () => {
      await bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.fire })
      await bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })
      const restored = await bin.restoreFolderFromBin(curator, { shelf: OFFICE_SHELF, folderId: folder.fire })
      expect(restored.restoredTo).toBe('root')
      expect(await folderRow(folder.fire)).toMatchObject({ parent_id: null, path: 'Brandschutz' })
    })
  })

  describe('one document', () => {
    it('goes to the bin in a folder of its own and comes back to the folder it came from', async () => {
      const binned = await documentBin.moveDocumentToBin(curator, doc.guide)
      expect(await shelfNames()).toEqual(['Brandschutz.pdf', 'Lose.pdf'])
      const { entries } = await bin.listFolderBin(curator, OFFICE_SHELF)
      expect(entries).toEqual([expect.objectContaining({ folderId: binned.binEntryId, document: { id: doc.guide, name: 'Leitfaden.pdf' } })])

      const restored = await documentBin.restoreDocumentFromBin(curator, doc.guide)
      expect(restored).toEqual({ documentId: doc.guide, folderId: folder.guides, restoredTo: 'original' })
      expect(await documentRow(doc.guide)).toMatchObject({ folder_id: folder.guides })
      expect(await folderRow(binned.binEntryId)).toBeUndefined()
    })
  })

  describe('the purge', () => {
    it('erases the documents and leaves the folders as tombstones, once the entry is due', async () => {
      await bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })
      await makeDue(folder.guides)
      expect(await claimable()).toContain(folder.guides)

      const result = await bin.purgeBinnedFolder(ORG, folder.guides)
      expect(result).toMatchObject({ status: 'purged', counts: { documents: 2, folders: 2 }, traceConversationIds: [] })
      expect(await documentRow(doc.fire)).toBeUndefined()
      expect((await folderRow(folder.fire))?.purged_at).not.toBeNull()
      expect(await bin.listFolderBin(curator, OFFICE_SHELF)).toMatchObject({ entries: [] })
    })

    it('runs at once for a curator („Endgültig löschen“), and audits it', async () => {
      await bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })
      await expect(bin.purgeFolderFromBinNow(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })).resolves.toMatchObject({ status: 'purged' })
      expect((await queueRow(folder.guides))[0].status).toBe('purged')
      expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'office_shelf.folder.purged' }))
    })
  })

  describe('Normen & Richtlinien', () => {
    it('deletes a Thema as it did: its norms move up, nothing goes to the bin', async () => {
      const result = await officeFolders.deleteOfficeShelfFolder(curator, folder.topic)
      expect(result).toMatchObject({ ok: true, result: { documentsMoved: 1 } })
      expect(await documentRow(doc.norm)).toMatchObject({ folder_id: folder.standards })
      expect(await queueRow(folder.topic)).toEqual([])
    })

    it('refuses a norm, and a folder that holds a listed norm, with norm-has-no-bin', async () => {
      await expect(documentBin.moveDocumentToBin(curator, doc.norm)).rejects.toMatchObject({ status: 409, details: { reason: 'norm-has-no-bin' } })
      norms.listed.add(doc.fire)
      await expect(bin.moveFolderToBin(curator, { shelf: OFFICE_SHELF, folderId: folder.guides })).rejects.toMatchObject({
        status: 409,
        details: { reason: 'norm-has-no-bin' },
      })
      expect((await folderRow(folder.guides))?.deleted_at).toBeNull()
    })
  })
})

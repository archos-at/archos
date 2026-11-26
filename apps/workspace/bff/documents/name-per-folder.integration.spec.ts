/**
 * @vitest-environment node
 *
 * A document's name is unique within its folder (migration 0271), against a
 * REAL Postgres through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/documents/name-per-folder.integration.spec.ts
 *
 * The unit suites pin the upload, move and rename against a doubled handle;
 * this one proves what only the database can: the index takes one name in two
 * folders and refuses it twice in one, in any case or Unicode form; the probe
 * folds case beyond ASCII although the cluster runs under the C locale; the
 * numbered names a folder already holds are read back as the index keys them;
 * and a move into a folder that holds the name asks before it writes.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://127.0.0.1:9' }))

const url = process.env.TEST_DATABASE_URL
const STAMP = Date.now()
const ORG = `org_names_${STAMP}`
const USER = 'user_names'
const COLLECTION = `coll_names_${STAMP}`

describe.skipIf(!url)('a document name is unique per folder, against Postgres (0271)', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let repo: typeof import('./repository')
  let storage: typeof import('@/lib/storage/repository')
  let move: typeof import('./move-to-folder')
  let shelf: typeof import('./shelf')
  let projectId: string
  let plans: string
  let archive: string

  const session = () =>
    ({ userId: USER, organizationId: ORG, role: 'member', permissions: [] }) as unknown as import('@/lib/auth/types').AuthorizedSession
  const inTenant = <T>(run: () => Promise<T>): Promise<T> => withTenant({ organizationId: ORG, userId: USER }, run)
  const firstId = (rows: Iterable<{ id: string }>): string => String(Array.from(rows)[0]?.id)

  async function insertFolder(name: string): Promise<string> {
    return firstId(
      await inTenant(() =>
        db.execute<{ id: string }>(sql`
          INSERT INTO project_folders (organization_id, project_id, parent_id, name, path)
          VALUES (${ORG}, ${projectId}::uuid, NULL, ${name}, ${name})
          RETURNING id
        `),
      ),
    )
  }

  function admit(filename: string, folderId: string | null, displayName: string | null = null): Promise<string> {
    const id = crypto.randomUUID()
    return inTenant(async () => {
      await storage.insertDocumentWithinQuota(
        {
          id,
          organizationId: ORG,
          projectId,
          scope: 'project',
          createdBy: USER,
          filename,
          displayName,
          storageKey: `k/${id}`,
          collectionName: COLLECTION,
          folderId,
          status: 'completed',
        },
        null,
      )
      return id
    })
  }

  const rowOf = async (id: string) =>
    Array.from(
      await inTenant(() =>
        db.execute<{ folder_id: string | null; filename: string; display_name: string | null }>(
          sql`SELECT folder_id, filename, display_name FROM documents WHERE id = ${id}::uuid`,
        ),
      ),
    )[0]

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    withTenant = (await import('@/lib/db/tenant-context')).withTenant
    db = (await import('@/lib/db')).getDb()
    repo = await import('./repository')
    storage = await import('@/lib/storage/repository')
    move = await import('./move-to-folder')
    shelf = await import('./shelf')

    projectId = firstId(
      await inTenant(() =>
        db.execute<{ id: string }>(sql`
          INSERT INTO projects (organization_id, name, created_by, collection_name)
          VALUES (${ORG}, 'Namen', ${USER}, ${COLLECTION})
          RETURNING id
        `),
      ),
    )
    plans = await insertFolder('Pläne')
    archive = await insertFolder('Archiv')
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    const { withPlatformAccess } = await import('@/lib/db/tenant-context')
    await withPlatformAccess('test teardown', async () => {
      await db.execute(sql`DELETE FROM documents WHERE organization_id = ${ORG}`)
      await db.execute(sql`DELETE FROM project_folders WHERE organization_id = ${ORG}`)
      await db.execute(sql`DELETE FROM projects WHERE organization_id = ${ORG}`)
    })
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('takes one name in two folders of a project, each a document of its own', async () => {
    const inPlans = await admit('Plan.pdf', plans)
    const inArchive = await admit('Plan.pdf', archive)

    expect(inPlans).not.toBe(inArchive)
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: plans }, 'Plan.pdf')).toMatchObject({ id: inPlans })
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: archive }, 'Plan.pdf')).toMatchObject({ id: inArchive })
  })

  it('refuses a name its folder holds in another case or Unicode form, at the root too, as a 409', async () => {
    await admit('Prüfbericht.pdf', archive)
    await admit('Lageplan.pdf', null)

    for (const [name, folderId] of [
      ['PLAN.pdf', plans],
      ['Prüfbericht.pdf', archive],
      [' lageplan.pdf', null],
    ] as const) {
      await expect(admit(name, folderId)).rejects.toMatchObject({ status: 409, details: { reason: 'live_name_taken' } })
    }
  })

  it('finds the holder of a name in its own folder only: by any case, the form macOS writes, or the name it was renamed to', async () => {
    const renamed = await admit('scan_0001.pdf', archive, 'Baubeschreibung.pdf')
    const umlaut = await admit('Übersicht.pdf', plans)
    const lines = await admit('Plan_A.pdf', plans)

    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: archive }, 'BAUBESCHREIBUNG.pdf')).toMatchObject({ id: renamed })
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: archive }, 'SCAN_0001.PDF')).toMatchObject({ id: renamed })
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: plans }, 'übersicht.pdf')).toMatchObject({ id: umlaut })
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: archive }, 'Prüfbericht.PDF')).not.toBeNull()
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: plans }, 'Plan_A.pdf')).toMatchObject({ id: lines })
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: plans }, 'PlanXA.pdf')).toBeNull()
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: plans }, 'Baubeschreibung.pdf')).toBeNull()
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: null, collectionName: COLLECTION }, 'Plan.pdf')).toBeNull()
    expect(
      await repo.findLiveDocumentByFilename(ORG, { folderId: plans }, 'Übersicht.pdf', { excluding: umlaut }),
    ).toBeNull()
  })

  it('finds a name whose lower case is longer than the name, which a pattern of the lowered key would miss', async () => {
    const istanbul = await admit('\u0130stanbul.pdf', plans)

    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: plans }, '\u0130stanbul.pdf')).toMatchObject({ id: istanbul })
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: plans }, '\u0130STANBUL.PDF')).toMatchObject({ id: istanbul })
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: plans }, 'i\u0307stanbul.pdf')).toMatchObject({ id: istanbul })
    expect(await repo.findFreeDocumentName(ORG, { folderId: plans }, '\u0130stanbul.pdf')).toBe('\u0130stanbul 2.pdf')
  })

  it('serialises two renames to one name in one folder: one writes, the other is told who holds it', async () => {
    const first = await admit('Grundriss_A.pdf', archive)
    const second = await admit('Grundriss_B.pdf', archive)

    const [a, b] = await Promise.all([
      repo.setDocumentDisplayNameInFolder(ORG, { folderId: archive }, first, 'Grundriss.pdf', 'Grundriss.pdf'),
      repo.setDocumentDisplayNameInFolder(ORG, { folderId: archive }, second, 'Grundriss.pdf', 'Grundriss.pdf'),
    ])

    expect([a, b].filter((holder) => holder === null)).toHaveLength(1)
    expect(a?.id ?? b?.id).toBe(a ? second : first)
    const shown = [await rowOf(first), await rowOf(second)].map((row) => row.display_name)
    expect(shown.filter((name) => name === 'Grundriss.pdf')).toHaveLength(1)
  })

  it('suggests the next free name the way the Finder does, in the spelling it came in, past the numbered names the folder holds', async () => {
    await admit('plan 2.pdf', plans)

    expect(await repo.findFreeDocumentName(ORG, { folderId: plans }, 'PLAN.pdf')).toBe('PLAN 3.pdf')
    expect(await repo.findFreeDocumentName(ORG, { folderId: archive }, 'plan.pdf')).toBe('plan 2.pdf')
  })

  it('never moves the row a replacement lands on: the folder is what it expects', async () => {
    const inPlans = (await repo.findLiveDocumentByFilename(ORG, { folderId: plans }, 'Plan.pdf'))!.id
    const next = {
      storageKey: `k/${inPlans}/v2`,
      storageBucket: null,
      fileSize: 1,
      contentType: 'application/pdf',
      contentHash: 'sha256:beef',
      createdBy: USER,
    }

    await expect(
      inTenant(() => storage.replaceDocumentWithinQuota(ORG, inPlans, { ...next, folderId: archive }, null)),
    ).rejects.toMatchObject({ details: { reason: 'replaced_document_gone' } })
    expect((await rowOf(inPlans)).folder_id).toBe(plans)
    await expect(
      inTenant(() => storage.replaceDocumentWithinQuota(ORG, inPlans, { ...next, folderId: plans }, null)),
    ).resolves.toEqual({ ok: true })
  })

  it('asks before it moves a document into a folder that holds its name, and keeps both when told to', async () => {
    const inArchive = (await repo.findLiveDocumentByFilename(ORG, { folderId: archive }, 'Plan.pdf'))!.id
    const inPlans = (await repo.findLiveDocumentByFilename(ORG, { folderId: plans }, 'Plan.pdf'))!.id

    const asked = await inTenant(() => move.moveDocumentToFolder({ documentId: inArchive, folderId: plans }, session()))
    expect(asked).toMatchObject({
      ok: false,
      conflict: { reason: 'name_conflict', existingDocumentId: inPlans, suggestedName: 'Plan 3.pdf' },
    })
    expect((await rowOf(inArchive)).folder_id).toBe(archive)

    const kept = await inTenant(() =>
      move.moveDocumentToFolder({ documentId: inArchive, folderId: plans, onConflict: 'keep_both' }, session()),
    )
    expect(kept).toMatchObject({ ok: true, changed: true })
    expect(await rowOf(inArchive)).toMatchObject({ folder_id: plans, filename: 'Plan 3.pdf', display_name: null })
    expect((await rowOf(inPlans)).filename).toBe('Plan.pdf')
  })

  it('refuses at the index a raw move into a folder holding the name, which is the race the move answers with the conflict', async () => {
    const twin = await admit('Lageplan.pdf', archive)
    const { isUniqueViolation } = await import('@/lib/db/errors')
    const { LIVE_NAME_INDEX } = await import('./unique-conflicts')

    const raced = await inTenant(() =>
      db.execute(sql`UPDATE documents SET folder_id = NULL WHERE id = ${twin}::uuid`),
    ).catch((error: unknown) => error)

    expect(isUniqueViolation(raced, LIVE_NAME_INDEX)).toBe(true)
    expect((await rowOf(twin)).folder_id).toBe(archive)
  })

  it('deletes one of two same-named documents and leaves the other where it is', async () => {
    const doomed = (await repo.findLiveDocumentByFilename(ORG, { folderId: null, collectionName: COLLECTION }, 'Lageplan.pdf'))!.id
    const kept = (await repo.findLiveDocumentByFilename(ORG, { folderId: archive }, 'Lageplan.pdf'))!.id

    await repo.deleteShelfDocumentRow(doomed, ORG, shelf.projectShelf(projectId))

    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: null, collectionName: COLLECTION }, 'Lageplan.pdf')).toBeNull()
    expect(await repo.findLiveDocumentByFilename(ORG, { folderId: archive }, 'Lageplan.pdf')).toMatchObject({ id: kept })
  })
})

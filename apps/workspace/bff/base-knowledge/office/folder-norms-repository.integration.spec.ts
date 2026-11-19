/**
 * @vitest-environment node
 *
 * The files of an office shelf folder the folder's norm notice reads, and the „Im Ordner lassen“ rows
 * (migration 0250), against a REAL Postgres through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/office/folder-norms-repository.integration.spec.ts
 *
 * What the SQL must hold: a file in an ordinary folder is read, one in the
 * standards tree, at the top level, already recorded or kept is not; a kept row
 * is the office's own and no other office reads it.
 */

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const ORG = `org_folder_norms_${Date.now()}`
const OTHER_ORG = `${ORG}_other`

describe.skipIf(!url)('norms in office shelf folders against Postgres', () => {
  let repo: typeof import('./folder-norms-repository')
  let store: typeof import('../store/repository')
  let SCREENED_ONLY: typeof import('@/lib/documents/document-reader').SCREENED_ONLY
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>
  const folders: Record<'normen' | 'standards' | 'topic' | 'planung', string> = { normen: '', standards: '', topic: '', planung: '' }

  const as = <T>(organizationId: string, run: () => Promise<T>): Promise<T> =>
    withTenant({ organizationId, userId: null }, run)

  async function folder(name: string, path: string, parentId: string | null = null): Promise<string> {
    const [row] = await as(ORG, () =>
      db.execute<{ id: string }>(sql`
        INSERT INTO project_folders (organization_id, scope, parent_id, name, path)
        VALUES (${ORG}, 'office_shelf', ${parentId}, ${name}, ${path})
        RETURNING id`)
    )
    return String(row.id)
  }

  async function file(filename: string, folderId: string | null, organizationId = ORG): Promise<string> {
    const [row] = await as(organizationId, () =>
      db.execute<{ id: string }>(sql`
        INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, folder_id)
        VALUES (${organizationId}, 'user_norms', ${filename}, ${`k/${randomUUID()}`}, ${`archiv_${organizationId}`},
                'completed', 'office_shelf', ${folderId})
        RETURNING id`)
    )
    return String(row.id)
  }

  const read = (options: { folderId: string; limit?: number }) => repo.listUndecidedFolderFiles(ORG, SCREENED_ONLY, { limit: 100, ...options })

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    repo = await import('./folder-norms-repository')
    store = await import('../store/repository')
    SCREENED_ONLY = (await import('@/lib/documents/document-reader')).SCREENED_ONLY
    folders.normen = await folder('Normen', 'Normen')
    folders.planung = await folder('Planung', 'Planung')
    folders.standards = await folder('Grundlagen des Büros', 'Grundlagen des Büros')
    folders.topic = await folder('Brandschutz', 'Grundlagen des Büros/Brandschutz', folders.standards)
  })

  afterAll(async () => {
    await withPlatformAccess('folder norms spec cleanup', async () => {
      await db.execute(sql`DELETE FROM documents WHERE organization_id IN (${ORG}, ${OTHER_ORG})`)
      await db.execute(sql`DELETE FROM project_folders WHERE organization_id IN (${ORG}, ${OTHER_ORG})`)
    })
  })

  it('reads the files in ordinary folders, never the standards tree or the top level', async () => {
    const inNormen = await file('OENORM_B_1600_2017-04-15.pdf', folders.normen)
    const inPlanung = await file('Grundriss_EG.pdf', folders.planung)
    await file('OENORM_B_5371.pdf', folders.standards)
    await file('OENORM_B_3806.pdf', folders.topic)
    await file('DIN_4109-1.pdf', null)

    expect((await read({ folderId: folders.planung })).map((row) => row.id)).toEqual([inPlanung])
    expect(await read({ folderId: folders.normen })).toEqual([
      { id: inNormen, fileName: 'OENORM_B_1600_2017-04-15.pdf', folderId: folders.normen },
    ])
    expect(await read({ folderId: folders.topic })).toEqual([])
    expect(await read({ folderId: folders.standards })).toEqual([])
  })

  it('reads at most the limit, in id order', async () => {
    await file('DIN_4109-2.pdf', folders.normen)
    const all = await read({ folderId: folders.normen })
    expect(all.length).toBeGreaterThan(1)
    expect(await read({ folderId: folders.normen, limit: 1 })).toEqual([all[0]])
  })

  it('leaves out a file already recorded as base knowledge', async () => {
    const recorded = await file('OENORM_B_2320.pdf', folders.normen)
    expect((await read({ folderId: folders.normen })).map((row) => row.id)).toContain(recorded)
    await store.insertProposedEntry(
      recorded,
      {
        kind: 'technical_standard',
        title: 'Wohnhäuser',
        designation: 'ÖNORM B 2320',
        editionLabel: 'unbekannt',
        issuedOn: null,
        inForceFrom: null,
        inForceTo: null,
        territoryIds: [],
        issuer: 'Austrian Standards',
        addressees: [],
        licenceClass: 'public_open',
      },
      { organizationId: ORG, createdBy: 'user_norms', provenance: { proposedBy: 'reading' }, terms: {} },
    )
    expect((await read({ folderId: folders.normen })).map((row) => row.id)).not.toContain(recorded)
  })

  it('leaves out a kept file for good, and no other office reads the decision', async () => {
    const kept = await file('Leitfaden_Brandschutz.pdf', folders.normen)
    await repo.keepAsOrdinaryFiles(ORG, [kept], 'user_norms')
    await repo.keepAsOrdinaryFiles(ORG, [kept], 'user_norms')
    expect((await read({ folderId: folders.normen })).map((row) => row.id)).not.toContain(kept)

    const mine = await as(ORG, () => db.execute(sql`SELECT kept_by FROM office_shelf_norm_keeps WHERE document_id = ${kept}`))
    expect(mine).toEqual([{ kept_by: 'user_norms' }])
    const theirs = await as(OTHER_ORG, () => db.execute(sql`SELECT 1 FROM office_shelf_norm_keeps WHERE document_id = ${kept}`))
    expect(theirs).toHaveLength(0)

    const other = await file('DIN_18040-1_kept_spec.pdf', folders.normen)
    expect(await repo.keptAsOrdinaryFiles(ORG, [kept, other], SCREENED_ONLY)).toEqual(new Set([kept]))
    expect(await repo.keptAsOrdinaryFiles(OTHER_ORG, [kept], SCREENED_ONLY)).toEqual(new Set())
  })

  it('offers a kept file again once the keep is forgotten („Rückgängig“), and another office cannot forget it', async () => {
    const parked = await file('OENORM_B_1300_parked.pdf', folders.normen)
    await repo.keepAsOrdinaryFiles(ORG, [parked], 'user_norms')
    await repo.forgetOrdinaryKeeps(OTHER_ORG, [parked])
    expect(await repo.keptAsOrdinaryFiles(ORG, [parked], SCREENED_ONLY)).toEqual(new Set([parked]))

    await repo.forgetOrdinaryKeeps(ORG, [parked])
    expect(await repo.keptAsOrdinaryFiles(ORG, [parked], SCREENED_ONLY)).toEqual(new Set())
    expect((await read({ folderId: folders.normen })).map((row) => row.id)).toContain(parked)
  })
})

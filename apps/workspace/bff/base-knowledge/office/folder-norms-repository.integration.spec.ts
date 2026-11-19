/**
 * @vitest-environment node
 *
 * The office shelf files a norm scan reads, and the „Im Ordner lassen“ rows
 * (migration 0250), against a REAL Postgres through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/office/folder-norms-repository.integration.spec.ts
 *
 * What the SQL must hold: a file in an ordinary folder is read, one in the
 * standards tree, at the top level, already recorded or kept is not; a kept row
 * is the office's own and no other office reads it; and refreshing the office's
 * inbox item rewrites an open item and leaves a resolved one alone.
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
  let inbox: typeof import('@/lib/inbox/repository')
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

  const read = (options: { folderId?: string | null; afterId?: string | null; limit?: number } = {}) =>
    repo.listUndecidedFolderFiles(ORG, SCREENED_ONLY, { limit: 100, ...options })

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    repo = await import('./folder-norms-repository')
    store = await import('../store/repository')
    inbox = await import('@/lib/inbox/repository')
    SCREENED_ONLY = (await import('@/lib/documents/document-reader')).SCREENED_ONLY
    folders.normen = await folder('Normen', 'Normen')
    folders.planung = await folder('Planung', 'Planung')
    folders.standards = await folder('Grundlagen des Büros', 'Grundlagen des Büros')
    folders.topic = await folder('Brandschutz', 'Grundlagen des Büros/Brandschutz', folders.standards)
  })

  afterAll(async () => {
    await withPlatformAccess('folder norms spec cleanup', async () => {
      await db.execute(sql`DELETE FROM inbox_items WHERE organization_id IN (${ORG}, ${OTHER_ORG})`)
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

    expect((await read()).map((row) => row.id).sort()).toEqual([inNormen, inPlanung].sort())
    expect(await read({ folderId: folders.normen })).toEqual([
      { id: inNormen, fileName: 'OENORM_B_1600_2017-04-15.pdf', folderId: folders.normen },
    ])
    expect(await read({ folderId: folders.topic })).toEqual([])
  })

  it('pages by id', async () => {
    const all = await read()
    const first = await read({ limit: 1 })
    expect(first).toEqual([all[0]])
    expect(await read({ afterId: first[0].id })).toEqual(all.slice(1))
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

  it('refreshes the open inbox item of the office and leaves a resolved one alone', async () => {
    const groupKey = `office_shelf.norms_found:organization:${ORG}`
    await as(ORG, () =>
      inbox.upsertInboxItems(
        ['user_open', 'user_done'].map((recipientUserId) => ({
          organizationId: ORG,
          recipientUserId,
          type: 'office_shelf.norms_found' as const,
          resourceType: 'organization' as const,
          resourceId: ORG,
          anchorId: folders.normen,
          groupKey,
          actionable: true,
          count: 3,
          payload: { excerpt: 'a.pdf, b.pdf, c.pdf' },
        })),
      ),
    )
    await as(ORG, () => db.execute(sql`UPDATE inbox_items SET resolved_at = now() WHERE recipient_user_id = 'user_done' AND group_key = ${groupKey}`))

    const refreshed = await as(ORG, () =>
      inbox.refreshOpenGroupItems({
        organizationId: ORG,
        groupKey,
        recipientUserIds: ['user_open', 'user_done'],
        anchorId: folders.planung,
        count: 1,
        payload: { excerpt: 'c.pdf' },
      }),
    )
    expect(refreshed).toEqual(['user_open'])
    const rows = await as(ORG, () =>
      db.execute<{ recipient_user_id: string; anchor_id: string; count: number; payload: { excerpt: string } }>(
        sql`SELECT recipient_user_id, anchor_id, count, payload FROM inbox_items WHERE group_key = ${groupKey} ORDER BY recipient_user_id`,
      ),
    )
    expect(rows.map((row) => [row.recipient_user_id, row.anchor_id, row.count, row.payload.excerpt])).toEqual([
      ['user_done', folders.normen, 3, 'a.pdf, b.pdf, c.pdf'],
      ['user_open', folders.planung, 1, 'c.pdf'],
    ])
  })
})

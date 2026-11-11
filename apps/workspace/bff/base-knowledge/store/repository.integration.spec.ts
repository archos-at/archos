/**
 * @vitest-environment node
 *
 * The base knowledge records against a REAL Postgres (migration 0202,
 * ADR-0163), through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/store/repository.integration.spec.ts
 *
 * What the SQL itself must hold, whatever the service does: another office
 * reads none of an office's records (with a positive control: the owner does);
 * a platform row is never written by a tenant (when one is read, and by whom,
 * is `../platform/platform.integration.spec.ts`, migration 0205); history is never updated or deleted on its own; an office cannot
 * attach its copy to another office's edition; and deleting the document
 * leaves no record, revision, body or check behind.
 */

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const ORG = `org_bk_${Date.now()}`
const OTHER_ORG = `${ORG}_other`

const AI_ALLOWED = {
  attestedBy: 'user_bk',
  attestedAt: '2026-11-10T08:00:00.000Z',
  aiProcessingAttestedBy: 'user_bk',
  aiProcessingAttestedAt: '2026-11-10T08:00:00.000Z',
}

const VALUES = {
  kind: 'technical_standard' as const,
  title: 'Barrierefreies Bauen',
  designation: 'ÖNORM B 1600:2017',
  editionLabel: '2017-04-01',
  issuedOn: '2017-04-01',
  territoryIds: [],
  issuer: 'Austrian Standards',
  addressees: [],
  licenceClass: 'licensed' as const,
}

describe.skipIf(!url)('base knowledge records against Postgres', () => {
  let repo: typeof import('./repository')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  const as = <T>(organizationId: string, run: () => Promise<T>): Promise<T> =>
    withTenant({ organizationId, userId: null }, run)

  async function newDocument(organizationId: string): Promise<string> {
    const [row] = await as(organizationId, () =>
      db.execute<{ id: string }>(sql`
        INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope)
        VALUES (${organizationId}, 'user_bk', ${`norm-${randomUUID()}.pdf`}, ${`k/${randomUUID()}`},
                ${`archiv_${organizationId}`}, 'completed', 'office_shelf')
        RETURNING id`)
    )
    return String(row.id)
  }

  const count = (table: string, column: string, value: string) =>
    withPlatformAccess('base knowledge spec residue count', async () => {
      const rows = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${value}`
      )
      return Number(rows[0].n)
    })

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    repo = await import('./repository')
  })

  afterAll(async () => {
    await withPlatformAccess('base knowledge spec cleanup', () =>
      db.execute(sql`DELETE FROM documents WHERE organization_id IN (${ORG}, ${OTHER_ORG})`)
    )
  })

  const propose = async (organizationId = ORG) => {
    const documentId = await newDocument(organizationId)
    const ids = await repo.insertProposedEntry(documentId, VALUES, {
      organizationId,
      createdBy: 'user_bk',
      provenance: { proposedBy: 'reading' },
      terms: {},
    })
    return { documentId, ids }
  }

  it('reads a proposal back to its office, and to no other office', async () => {
    const { documentId, ids } = await propose()
    const mine = await repo.readOfficeEntries(ORG, [documentId])
    // Positive control: without it, an empty read below would prove nothing.
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ workId: ids.workId, confirmed: false, values: VALUES })
    expect(await repo.readOfficeEntries(OTHER_ORG, [documentId])).toEqual([])
    const leaked = await as(OTHER_ORG, () =>
      db.execute(sql`SELECT 1 FROM knowledge_revisions WHERE record_id = ${ids.workId}`)
    )
    expect(leaked).toHaveLength(0)
  })

  it('keeps one entry per document: a second proposal that lost the race is a conflict', async () => {
    const { documentId } = await propose()
    const context = { organizationId: ORG, createdBy: 'user_bk', provenance: { proposedBy: 'reading' as const }, terms: {} }
    await expect(repo.insertProposedEntry(documentId, VALUES, context)).rejects.toMatchObject({ name: 'ConflictError' })
    // Positive control: another document still takes an entry.
    await expect(propose()).resolves.toMatchObject({ ids: { workId: expect.any(String) } })
  })

  it('names a shelf file that is already recorded, so an upload under its name is refused before it writes', async () => {
    const office = await import('../office/repository')
    const reader = { kind: 'member' as const, userId: 'user_bk' }
    const { documentId } = await propose()
    const [row] = await as(ORG, () => db.execute<{ filename: string }>(sql`SELECT filename FROM documents WHERE id = ${documentId}`))
    expect(await office.shelfNameHasEntry(ORG, String(row.filename), reader)).toBe(true)
    // Positive control: an unrecorded name, and the same name in another office, are free.
    expect(await office.shelfNameHasEntry(ORG, 'not-recorded.pdf', reader)).toBe(false)
    expect(await office.shelfNameHasEntry(OTHER_ORG, String(row.filename), reader)).toBe(false)
  })

  it('states a proposed copy’s licence before any confirmation, so its text can be held back', async () => {
    const { documentId, ids } = await propose()
    expect(await repo.copyForDocument(ORG, documentId)).toEqual({
      licenceClass: 'licensed',
      editionId: ids.editionId,
      terms: {},
      confirmed: false,
    })
    expect(await repo.copyForDocument(OTHER_ORG, documentId)).toBeNull()
  })

  it('moves the heads on confirmation, records the first check, and keeps the proposal in the history', async () => {
    const { documentId, ids } = await propose()
    await repo.writeConfirmedValues(ids, { ...VALUES, editionLabel: '2017-05-01' }, {
      organizationId: ORG,
      createdBy: 'user_bk',
      provenance: { proposedBy: 'person' },
      terms: AI_ALLOWED,
      firstCheck: true,
    })
    const [entry] = await repo.readOfficeEntries(ORG, [documentId])
    expect(entry).toMatchObject({ confirmed: true, values: { editionLabel: '2017-05-01' }, lastCheck: { result: 'current' } })
    expect(await count('knowledge_revisions', 'record_id', ids.workId)).toBe(2)
    expect(await repo.copyForDocument(ORG, documentId)).toEqual({
      licenceClass: 'licensed',
      editionId: ids.editionId,
      terms: AI_ALLOWED,
      confirmed: true,
    })
  })

  it('refuses to update or delete a revision, a body or a check on its own', async () => {
    const { ids } = await propose()
    await repo.insertCopyCheck(ORG, ids.copyId, { checkedBy: 'user_bk', result: 'current', note: null })
    for (const statement of [
      sql`UPDATE knowledge_revisions SET created_by = 'x' WHERE record_id = ${ids.workId}`,
      sql`DELETE FROM knowledge_revisions WHERE record_id = ${ids.workId}`,
      sql`UPDATE knowledge_work_revisions SET title = 'x' WHERE record_id = ${ids.workId}`,
      sql`DELETE FROM knowledge_checks WHERE target_id = ${ids.copyId}`,
    ]) {
      await expect(as(ORG, () => db.execute(statement))).rejects.toThrow()
    }
    // A record changes its head only.
    await expect(as(ORG, () => db.execute(sql`UPDATE knowledge_records SET created_by = 'x' WHERE id = ${ids.workId}`))).rejects.toThrow()
  })

  it('refuses a copy on another office’s edition, and a tenant write of a platform row', async () => {
    const theirs = await propose(OTHER_ORG)
    const mine = await propose()
    const revisionId = randomUUID()
    await expect(
      as(ORG, () =>
        db.transaction(async (tx) => {
          await tx.execute(sql`INSERT INTO knowledge_revisions (revision_id, record_id, record_type, organization_id, created_by)
                               VALUES (${revisionId}, ${mine.ids.copyId}, 'manifestation', ${ORG}, 'user_bk')`)
          await tx.execute(sql`INSERT INTO knowledge_manifestation_revisions (revision_id, record_id, organization_id, edition_id, licence_class)
                               VALUES (${revisionId}, ${mine.ids.copyId}, ${ORG}, ${theirs.ids.editionId}, 'licensed')`)
        })
      )
    ).rejects.toThrow()
    await expect(
      as(ORG, () =>
        db.execute(sql`INSERT INTO knowledge_records (id, organization_id, type, created_by) VALUES (${`work_${randomUUID()}`}, NULL, 'work', 'user_bk')`)
      )
    ).rejects.toThrow()
  })

  it('leaves nothing behind once the document is deleted', async () => {
    const { documentId, ids } = await propose()
    await repo.writeConfirmedValues(ids, VALUES, {
      organizationId: ORG,
      createdBy: 'user_bk',
      provenance: { proposedBy: 'person' },
      terms: AI_ALLOWED,
      firstCheck: true,
    })
    await repo.insertCopyCheck(ORG, ids.copyId, { checkedBy: 'user_bk', result: 'newer_known', note: null })
    await as(ORG, () => db.execute(sql`DELETE FROM documents WHERE id = ${documentId}`))
    for (const id of [ids.workId, ids.editionId, ids.copyId]) {
      expect(await count('knowledge_records', 'id', id)).toBe(0)
      expect(await count('knowledge_revisions', 'record_id', id)).toBe(0)
    }
    expect(await count('knowledge_work_revisions', 'record_id', ids.workId)).toBe(0)
    expect(await count('knowledge_edition_revisions', 'record_id', ids.editionId)).toBe(0)
    expect(await count('knowledge_manifestation_revisions', 'record_id', ids.copyId)).toBe(0)
    expect(await count('knowledge_checks', 'target_id', ids.copyId)).toBe(0)
  })
})

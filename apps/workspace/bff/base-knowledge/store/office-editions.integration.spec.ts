/**
 * @vitest-environment node
 *
 * A newer edition of an office's standard against a REAL Postgres (migration
 * 0202, `office-editions.ts`), through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/store/office-editions.integration.spec.ts
 *
 * What must hold: the second edition joins the first one's work, so the
 * platform's edition-in-time read (`time/repository.ts` `readWorkInTime`)
 * sees both; removing the FIRST document leaves the second edition whole
 * (the work was made to stand alone before it joined); and removing the last
 * edition leaves no work behind.
 */

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const ORG = `org_bke_${Date.now()}`

const VALUES = {
  kind: 'technical_standard' as const,
  title: 'Barrierefreies Bauen',
  designation: 'ÖNORM B 1600:2017',
  editionLabel: '2017-04-01',
  issuedOn: '2017-04-01',
  inForceFrom: null,
  inForceTo: null,
  territoryIds: [],
  issuer: 'Austrian Standards',
  addressees: [],
  licenceClass: 'public_open' as const,
}
const NEWER = { ...VALUES, designation: 'ÖNORM B 1600:2023', editionLabel: '2023-02-01', issuedOn: '2023-02-01' }

describe('the suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('a newer edition of an office standard against Postgres', () => {
  let repo: typeof import('./repository')
  let editions: typeof import('./office-editions')
  let time: typeof import('../time/repository')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>

  const context = { organizationId: ORG, createdBy: 'user_bk', provenance: { proposedBy: 'reading' as const }, terms: {} }

  async function newDocument(): Promise<string> {
    const [row] = await withTenant({ organizationId: ORG, userId: null }, () =>
      db.execute<{ id: string }>(sql`
        INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope)
        VALUES (${ORG}, 'user_bk', ${`norm-${randomUUID()}.pdf`}, ${`k/${randomUUID()}`}, ${`archiv_${ORG}`}, 'completed', 'office_shelf')
        RETURNING id`),
    )
    return String(row.id)
  }

  const removeDocument = (documentId: string) =>
    withTenant({ organizationId: ORG, userId: null }, () => db.execute(sql`DELETE FROM documents WHERE id = ${documentId}`))

  const recordExists = (id: string) =>
    withPlatformAccess('office editions spec', async () => {
      const rows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM knowledge_records WHERE id = ${id}`)
      return Number(rows[0].n) > 0
    })

  async function confirmedFirst() {
    const documentId = await newDocument()
    const ids = await repo.insertProposedEntry(documentId, VALUES, context)
    await repo.writeConfirmedValues(ids, VALUES, { ...context, firstCheck: true })
    const [stored] = await repo.readOfficeEntries(ORG, [documentId])
    return { documentId, stored }
  }

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    const tenant = await import('@/lib/db/tenant-context')
    withTenant = tenant.withTenant
    withPlatformAccess = tenant.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    repo = await import('./repository')
    editions = await import('./office-editions')
    time = await import('../time/repository')
  })

  afterAll(async () => {
    await withPlatformAccess('office editions spec cleanup', async () => {
      await db.execute(sql`DELETE FROM documents WHERE organization_id = ${ORG}`)
      await db.execute(sql`DELETE FROM knowledge_records WHERE organization_id = ${ORG}`)
    })
  })

  it('joins the first edition’s work, which the platform’s edition read then sees whole', async () => {
    const { stored: first } = await confirmedFirst()
    expect(first.workStandsAlone).toBe(false)
    const secondDocument = await newDocument()
    const ids = await editions.insertEditionOfWork(secondDocument, first, NEWER, context)
    await repo.writeConfirmedValues(ids, { ...NEWER, designation: 'ÖNORM B 1600' }, { ...context, firstCheck: true })

    const all = await repo.readOfficeEntries(ORG)
    const series = all.filter((entry) => entry.workId === ids.workId)
    expect(series.map((entry) => entry.values.editionLabel).sort()).toEqual(['2017-04-01', '2023-02-01'])
    expect(series.every((entry) => entry.workStandsAlone && entry.confirmed)).toBe(true)
    expect(series.map((entry) => entry.values.designation)).toEqual(['ÖNORM B 1600', 'ÖNORM B 1600'])
    const read = await time.readWorkInTime(ORG, ids.workId)
    expect(read?.work.editions.map((edition) => edition.label).sort()).toEqual(['2017-04-01', '2023-02-01'])
  })

  it('keeps the newer edition whole when the first document goes, and the work with it', async () => {
    const { documentId: firstDocument, stored: first } = await confirmedFirst()
    const secondDocument = await newDocument()
    const ids = await editions.insertEditionOfWork(secondDocument, first, NEWER, context)
    await removeDocument(firstDocument)

    const [left] = await repo.readOfficeEntries(ORG, [secondDocument])
    expect(left).toMatchObject({ editionId: ids.editionId, workId: ids.workId, values: { editionLabel: '2023-02-01', title: VALUES.title } })
    expect(await editions.deleteWorkIfUnused(ORG, ids.workId)).toBe(false)
    expect(await recordExists(ids.workId)).toBe(true)
  })

  it('ends two newer editions added at once in one work, though both read the first before either wrote', async () => {
    const { documentId: firstDocument, stored: first } = await confirmedFirst()
    const [a, b] = await Promise.all([newDocument(), newDocument()])
    const [one, two] = await Promise.all([
      editions.insertEditionOfWork(a, first, NEWER, context),
      editions.insertEditionOfWork(b, first, { ...NEWER, editionLabel: '2024-01-01' }, context),
    ])
    expect(two.workId).toBe(one.workId)
    const marks = await repo.entryIdsForDocuments(ORG, [firstDocument, a, b])
    expect(marks).toEqual(new Map([[firstDocument, first.editionId], [a, one.editionId], [b, two.editionId]]))
  })

  it('keeps an edit from a read made before a newer edition joined on the shared work', async () => {
    const { stored: first } = await confirmedFirst()
    const ids = await editions.insertEditionOfWork(await newDocument(), first, NEWER, context)
    await repo.writeConfirmedValues(first, { ...first.values, title: 'Barrierefreies Bauen, korrigiert' }, context)

    const series = (await repo.readOfficeEntries(ORG)).filter((entry) => entry.editionId === first.editionId || entry.editionId === ids.editionId)
    expect(series.map((entry) => entry.workId)).toEqual([ids.workId, ids.workId])
    expect(series.every((entry) => entry.values.title === 'Barrierefreies Bauen, korrigiert')).toBe(true)
  })

  it('keeps a person’s values on a proposal that stays one', async () => {
    const documentId = await newDocument()
    const ids = await repo.insertProposedEntry(documentId, { ...VALUES, editionLabel: 'unbekannt', issuedOn: null }, context)
    await repo.writeProposedValues({ ...ids, workStandsAlone: false }, { ...VALUES, kind: 'guideline', designation: 'ÖNORM B 1601', editionLabel: 'unbekannt', issuedOn: null }, {
      ...context,
      provenance: { proposedBy: 'person' },
    })

    const [read] = await repo.readOfficeEntries(ORG, [documentId])
    expect(read).toMatchObject({ confirmed: false, provenance: { proposedBy: 'person' }, values: { kind: 'guideline', designation: 'ÖNORM B 1601' } })
  })

  it('revises a newer edition’s proposal without touching the work it shares', async () => {
    const { stored: first } = await confirmedFirst()
    const documentId = await newDocument()
    const ids = await editions.insertEditionOfWork(documentId, first, { ...NEWER, editionLabel: 'unbekannt', issuedOn: null }, context)
    const [proposal] = await repo.readOfficeEntries(ORG, [documentId])
    await repo.writeProposedValues(proposal, { ...proposal.values, kind: 'guideline', title: 'Anders', editionLabel: '2023-02-01' }, context)

    const series = (await repo.readOfficeEntries(ORG)).filter((entry) => entry.workId === ids.workId)
    expect(series.map((entry) => [entry.values.editionLabel, entry.confirmed, entry.values.kind, entry.values.title]).sort()).toEqual([
      ['2017-04-01', true, 'technical_standard', VALUES.title],
      ['2023-02-01', false, 'technical_standard', VALUES.title],
    ])
  })

  it('leaves no work behind once the last edition is gone', async () => {
    const { documentId: firstDocument, stored: first } = await confirmedFirst()
    const secondDocument = await newDocument()
    const ids = await editions.insertEditionOfWork(secondDocument, first, NEWER, context)
    await removeDocument(firstDocument)
    await removeDocument(secondDocument)

    expect(await editions.deleteWorkIfUnused(ORG, ids.workId)).toBe(true)
    expect(await recordExists(ids.workId)).toBe(false)
  })
})

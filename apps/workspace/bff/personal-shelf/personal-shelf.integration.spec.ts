/**
 * @vitest-environment node
 */

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL

const STAMP = Date.now()
const ORG = `org_personal_shelf_${STAMP}`
const OWNER = `user_owner_${STAMP}`
const COLLEAGUE = `user_colleague_${STAMP}`
const ADMIN = `user_admin_${STAMP}`

const DOCUMENT = randomUUID()
const OFFICE_DOCUMENT = randomUUID()
const FOLDER = randomUUID()
const VERSION = randomUUID()

describe('the personal shelf suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(
      url,
      'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set, so the personal shelf suite skipped ' +
        'and nothing verified that a colleague cannot read someone else’s Meine Ablage. Check `task db:test:rls`.'
    ).toBeTruthy()
  })
})

describe.skipIf(!url)('a personal shelf against live Postgres (ADR-0191 rule 1, migration 0258)', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess

  const as = <T>(userId: string | null, run: () => Promise<T>): Promise<T> => withTenant({ organizationId: ORG, userId }, run)
  const ids = async (userId: string | null, query: ReturnType<typeof sql>): Promise<string[]> =>
    [...(await as(userId, () => db.execute(query)))].map((row) => String(row.id))

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()

    await as(OWNER, async () => {
      await db.execute(sql`
        insert into project_folders (id, organization_id, scope, owner_user_id, name, path)
        values (${FOLDER}, ${ORG}, 'personal', ${OWNER}, 'Wettbewerbe', 'Wettbewerbe')`)
      await db.execute(sql`
        insert into documents (id, organization_id, scope, owner_user_id, created_by, filename, storage_key, collection_name, folder_id)
        values (${DOCUMENT}, ${ORG}, 'personal', ${OWNER}, ${OWNER}, 'Anfrage Huber.pdf', 'k/1', 'personal_x', ${FOLDER})`)
      await db.execute(sql`
        insert into documents (id, organization_id, scope, created_by, filename, storage_key, collection_name)
        values (${OFFICE_DOCUMENT}, ${ORG}, 'office_shelf', ${OWNER}, 'Vorlage.pdf', 'k/2', 'office_shelf_x')`)
      await db.execute(sql`
        insert into document_versions (id, organization_id, document_id, version_number, storage_key, created_by)
        values (${VERSION}, ${ORG}, ${DOCUMENT}, 1, 'k/1', ${OWNER})`)
      await db.execute(sql`
        insert into document_search_facets (document_id, organization_id, title, fingerprint)
        values (${DOCUMENT}, ${ORG}, 'Anfrage Huber', 'f')`)
    })
  })

  afterAll(async () => {
    if (!db) return
    await withPlatformAccess('test teardown', async () => {
      await db.execute(sql`delete from documents where organization_id = ${ORG}`)
      await db.execute(sql`delete from project_folders where organization_id = ${ORG}`)
    })
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('shows the owner their own documents, folders, versions and search rows', async () => {
    expect(await ids(OWNER, sql`select id from documents order by filename`)).toEqual([DOCUMENT, OFFICE_DOCUMENT])
    expect(await ids(OWNER, sql`select id from project_folders`)).toEqual([FOLDER])
    expect(await ids(OWNER, sql`select id from document_versions`)).toEqual([VERSION])
    expect(await ids(OWNER, sql`select document_id as id from document_search_facets`)).toEqual([DOCUMENT])
  })

  it.each([
    ['a colleague', COLLEAGUE],
    ['an administrator, who is a person like any other here', ADMIN],
  ])('shows %s none of it, whatever the WHERE names, and the office shelf as before', async (_who, reader) => {
    expect(await ids(reader, sql`select id from documents where id in (${DOCUMENT}, ${OFFICE_DOCUMENT})`)).toEqual([OFFICE_DOCUMENT])
    expect(await ids(reader, sql`select id from project_folders where id = ${FOLDER}`)).toEqual([])
    expect(await ids(reader, sql`select id from document_versions where document_id = ${DOCUMENT}`)).toEqual([])
    expect(await ids(reader, sql`select document_id as id from document_search_facets where document_id = ${DOCUMENT}`)).toEqual([])
  })

  it('lets nobody else change or delete it: the statement matches no row', async () => {
    await as(COLLEAGUE, () => db.execute(sql`update documents set filename = 'taken.pdf' where id = ${DOCUMENT}`))
    await as(COLLEAGUE, () => db.execute(sql`delete from project_folders where id = ${FOLDER}`))
    expect(await ids(OWNER, sql`select id from documents where filename = 'Anfrage Huber.pdf'`)).toEqual([DOCUMENT])
    expect(await ids(OWNER, sql`select id from project_folders`)).toEqual([FOLDER])
  })

  it('refuses a row written for someone else under one’s own name', async () => {
    await expect(
      as(COLLEAGUE, () =>
        db.execute(sql`
          insert into documents (organization_id, scope, owner_user_id, created_by, filename, storage_key, collection_name)
          values (${ORG}, 'personal', ${OWNER}, ${COLLEAGUE}, 'planted.pdf', 'k/3', 'personal_x')`)
      )
    ).rejects.toThrow()
  })

  it('lets a worker acting for no person read it, as it reads every row of the office', async () => {
    expect(await ids(null, sql`select id from documents where id = ${DOCUMENT}`)).toEqual([DOCUMENT])
  })

  it('holds a personal row to its owner and keeps it out of every project', async () => {
    await expect(
      as(OWNER, () =>
        db.execute(sql`
          insert into documents (organization_id, scope, created_by, filename, storage_key, collection_name)
          values (${ORG}, 'personal', ${OWNER}, 'ownerless.pdf', 'k/4', 'personal_x')`)
      )
    ).rejects.toThrow()
  })
})

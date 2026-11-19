/**
 * @vitest-environment node
 *
 * The Verweis and „Hier lassen“ of migration 0250 against a REAL Postgres,
 * through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/office-shelf/project-norms/repository.integration.spec.ts
 *
 * What must hold: deleting the office shelf copy keeps the reference and
 * shows it as removed; a kept norm is forgotten with its document; and
 * another office reads and writes neither table.
 */

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const ORG = `org_osr_${Date.now()}`
const OTHER = `org_osr_other_${Date.now()}`

describe('the suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('references and kept norms against Postgres', () => {
  let repo: typeof import('./repository')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let projectId: string

  const asOffice = <T>(organizationId: string, run: () => Promise<T>) => withTenant({ organizationId, userId: null }, run)

  async function newDocument(scope: 'project' | 'office_shelf'): Promise<string> {
    const [row] = await asOffice(ORG, () =>
      db.execute<{ id: string }>(sql`
        INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id)
        VALUES (${ORG}, 'user_osr', ${`OENORM_B_1600-${randomUUID()}.pdf`}, ${`k/${randomUUID()}`}, ${`c_${ORG}`}, 'completed',
                ${scope}, ${scope === 'project' ? projectId : null})
        RETURNING id`)
    )
    return String(row.id)
  }

  const removeDocument = (documentId: string) =>
    asOffice(ORG, () => db.execute(sql`DELETE FROM documents WHERE id = ${documentId}`))

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    const tenant = await import('@/lib/db/tenant-context')
    withTenant = tenant.withTenant
    withPlatformAccess = tenant.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    repo = await import('./repository')
    const [project] = await asOffice(ORG, () =>
      db.execute<{ id: string }>(sql`
        INSERT INTO projects (organization_id, name, created_by, collection_name)
        VALUES (${ORG}, 'Wohnhaus Floridsdorf', 'user_osr', ${`p_${ORG}`})
        RETURNING id`)
    )
    projectId = String(project.id)
  })

  afterAll(async () => {
    await withPlatformAccess('office shelf references spec cleanup', async () => {
      await db.execute(sql`DELETE FROM documents WHERE organization_id = ${ORG}`)
      await db.execute(sql`DELETE FROM projects WHERE organization_id = ${ORG}`)
    })
  })

  it('keeps the reference when the office shelf copy is deleted, and shows it as removed', async () => {
    const source = await newDocument('project')
    const copy = await newDocument('office_shelf')
    await repo.insertReference({
      organizationId: ORG,
      projectId,
      folderId: null,
      sourceDocumentId: source,
      officeDocumentId: copy,
      fileName: 'OENORM_B_1600.pdf',
      placedAs: 'moved',
      createdBy: 'user_osr',
    })
    const before = await repo.listReferences(ORG, projectId, null, { offset: 0, limit: 50 })
    expect(before.find((row) => row.sourceDocumentId === source)?.officeDocumentId).toBe(copy)

    await removeDocument(copy)

    const after = await repo.listReferences(ORG, projectId, null, { offset: 0, limit: 50 })
    expect(after.find((row) => row.sourceDocumentId === source)).toMatchObject({ officeDocumentId: null, fileName: 'OENORM_B_1600.pdf' })
  })

  it('forgets „Hier lassen“ with its document, and keeps it once however often it is said', async () => {
    const kept = await newDocument('project')
    await repo.keepInProject(ORG, projectId, [kept], 'user_osr')
    await repo.keepInProject(ORG, projectId, [kept], 'user_osr')
    expect(await repo.keptAmong(ORG, [kept])).toEqual(new Set([kept]))
    await removeDocument(kept)
    expect(await repo.keptAmong(ORG, [kept])).toEqual(new Set())
  })

  it('shows another office neither the references nor the kept norms, and refuses its writes', async () => {
    const kept = await newDocument('project')
    await repo.keepInProject(ORG, projectId, [kept], 'user_osr')
    expect(await repo.listReferences(OTHER, projectId, null, { offset: 0, limit: 50 })).toEqual([])
    expect(await repo.keptAmong(OTHER, [kept])).toEqual(new Set())
    const counts = await asOffice(OTHER, () =>
      db.execute<{ refs: number; keeps: number }>(sql`
        SELECT (SELECT count(*)::int FROM office_shelf_references) AS refs, (SELECT count(*)::int FROM office_shelf_norm_keeps) AS keeps`)
    )
    expect(counts[0]).toEqual({ refs: 0, keeps: 0 })
    await expect(
      asOffice(OTHER, () =>
        db.execute(sql`
          INSERT INTO office_shelf_norm_keeps (document_id, organization_id, project_id, kept_by)
          VALUES (${kept}, ${ORG}, ${projectId}, 'user_intruder')`)
      )
    ).rejects.toThrow()
  })
})

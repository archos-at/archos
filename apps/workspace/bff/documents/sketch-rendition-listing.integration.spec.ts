/**
 * @vitest-environment node
 *
 * One document, one row in Files (ADR-0148): the PDF filed beside a diagram is
 * its picture's rendition, so a level read lists the picture alone while both
 * sit in one folder. A PDF moved apart from its picture, or a lone PDF, is
 * listed on its own. Against a REAL Postgres, through the restricted runtime
 * role (`task db:test:rls`, or `bash scripts/rls-test-db.sh --only` this file).
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { REVIEWER_READER } from '@/lib/documents/document-reader'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const ORG = `org_rendition_${Date.now()}`
const USER = 'user_rendition'

describe.skipIf(!url)('a diagram’s PDF in the Files listing', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let repo: typeof import('./repository')
  let shelf: typeof import('./shelf')
  let projectId: string
  let folderId: string

  const inTenant = <T>(run: () => Promise<T>): Promise<T> => withTenant({ organizationId: ORG, userId: USER }, run)

  async function file(name: string, producer: 'diagram_svg' | 'diagram_pdf', ref: string, folder: string | null): Promise<void> {
    const type = producer === 'diagram_svg' ? 'image/svg+xml' : 'application/pdf'
    await inTenant(() =>
      db.execute(sql`
        INSERT INTO documents
          (organization_id, created_by, filename, storage_key, collection_name, status, scope, project_id, folder_id,
           content_type, authored_by, authored_by_producer, authored_by_ref, authored_by_ref_kind)
        VALUES
          (${ORG}, ${USER}, ${name}, ${`k/${name}`}, 'coll_rendition', 'completed', 'project', ${projectId}::uuid, ${folder}::uuid,
           ${type}, 'agent', ${producer}, ${ref}, 'answer_artifact')
      `),
    )
  }

  const names = async (folder: string | null) => {
    const page = await inTenant(() =>
      repo.listDocumentLevelPage(shelf.projectShelf(projectId), ORG, {
        reader: REVIEWER_READER,
        level: { folderId: folder, sort: 'name', dir: 'asc', limit: 100 },
      }),
    )
    return page.rows.map((row) => row.filename)
  }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    db = (await import('@/lib/db')).getDb()
    repo = await import('./repository')
    shelf = await import('./shelf')
    const projects = await inTenant(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO projects (organization_id, name, created_by, collection_name)
        VALUES (${ORG}, 'Renditions', ${USER}, 'coll_rendition') RETURNING id
      `),
    )
    projectId = String(Array.from(projects)[0].id)
    const folders = await inTenant(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO project_folders (organization_id, project_id, name, path)
        VALUES (${ORG}, ${projectId}::uuid, 'Skizzen', 'Skizzen') RETURNING id
      `),
    )
    folderId = String(Array.from(folders)[0].id)
    await file('Raumprogramm.svg', 'diagram_svg', 'ans-1-a', null)
    await file('Raumprogramm.pdf', 'diagram_pdf', 'ans-1-a', null)
    // Moved apart: the picture into the folder, its PDF left at the root.
    await file('Stiege.svg', 'diagram_svg', 'ans-2-b', folderId)
    await file('Stiege.pdf', 'diagram_pdf', 'ans-2-b', null)
    // A PDF whose picture is gone.
    await file('Ablauf.pdf', 'diagram_pdf', 'ans-3-c', null)
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

  it('lists the picture alone where its PDF lies beside it, and a PDF on its own otherwise', async () => {
    expect(await names(null)).toEqual(['Ablauf.pdf', 'Raumprogramm.svg', 'Stiege.pdf'])
    expect(await names(folderId)).toEqual(['Stiege.svg'])
  })
})

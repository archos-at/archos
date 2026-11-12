/**
 * @vitest-environment node
 */
/**
 * The project shelf’s topics (ADR-0180, ADR-0087) against a REAL Postgres with the
 * full migration chain, as the restricted runtime role:
 *
 *   - a rename moves only the open notes and the restricted notes the reader is
 *     cleared for, and leaves a restricted note alone for anyone else;
 *   - the topic counts a reader sees are over the notes that reader may see, so a
 *     restricted topic never shows up in another reader’s list.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/projects/memory-topics.integration.spec.ts
 *
 * `task db:test:rls` (scripts/rls-test-db.sh) builds that database and runs this file.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL

const STAMP = Date.now()
const ORG = `org_shelf_topics_${STAMP}`
const USER = `user_shelf_topics_${STAMP}`

describe('the project topics suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('project memory topics against live Postgres', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let topics: typeof import('./memory-topics')

  const inTenant = <T>(run: () => Promise<T>): Promise<T> => withTenant({ organizationId: ORG, userId: USER }, run)
  const firstId = (rows: Iterable<{ id: unknown }>): string => String(Array.from(rows)[0]?.id)

  let projectId: string
  let folderId: string

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    topics = await import('./memory-topics')

    const collection = `proj_topics_${STAMP}`
    projectId = firstId(
      await inTenant(() =>
        db.execute<{ id: string }>(sql`
          insert into projects (organization_id, name, created_by, collection_name)
          values (${ORG}, 'Topics', ${USER}, ${collection}) returning id`)
      )
    )
    folderId = firstId(
      await inTenant(() =>
        db.execute<{ id: string }>(sql`
          insert into project_folders (organization_id, project_id, name, path, access_mode, access_changed_by, access_changed_at)
          values (${ORG}, ${projectId}::uuid, 'Verträge', 'Verträge', 'custom', ${USER}, now())
          returning id`)
      )
    )
    await inTenant(async () => {
      await db.execute(sql`
        insert into project_memory (scope, project_id, organization_id, kind, content, topic)
        values ('project', ${projectId}::uuid, ${ORG}, 'decision', 'Open: fire doors on floor two.', 'Brandschutz')`)
      await db.execute(sql`
        insert into project_memory (scope, project_id, organization_id, kind, content, topic)
        values ('project', ${projectId}::uuid, ${ORG}, 'decision', 'Open: parking on the north side.', 'Stellplätze')`)
      await db.execute(sql`
        insert into project_memory (scope, project_id, organization_id, kind, content, topic, restricted_folder_ids)
        values ('project', ${projectId}::uuid, ${ORG}, 'decision', 'Restricted: the fee agreement caps the scope.', 'Brandschutz', array[${folderId}::uuid])`)
    })
  })

  afterAll(async () => {
    if (!db) return
    await withPlatformAccess('test teardown', async () => {
      await db.execute(sql`delete from project_memory where organization_id = ${ORG}`)
      await db.execute(sql`delete from project_folders where organization_id = ${ORG}`)
      await db.execute(sql`delete from projects where organization_id = ${ORG}`)
    })
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('counts the topics a reader who is not cleared sees: the open notes only', async () => {
    const counted = await inTenant(() => topics.projectTopicsOf(projectId, ORG, []))
    expect(counted).toEqual([
      { name: 'Brandschutz', count: 1 },
      { name: 'Stellplätze', count: 1 },
    ])
  })

  it('moves only the notes an uncleared reader sees: the restricted note keeps its topic', async () => {
    const result = await inTenant(() =>
      topics.renameProjectShelfTopic({ projectId, organizationId: ORG, readable: [], from: 'Brandschutz', to: 'Feuerschutz' })
    )
    expect(result).toEqual({ moved: 1 })
    const restricted = await inTenant(() =>
      db.execute<{ topic: string }>(sql`select topic from project_memory where organization_id = ${ORG} and restricted_folder_ids is not null`)
    )
    expect(Array.from(restricted).map((row) => row.topic)).toEqual(['Brandschutz'])
  })

  it('a reader cleared for the restricted folder sees and moves that note too', async () => {
    const counted = await inTenant(() => topics.projectTopicsOf(projectId, ORG, [folderId]))
    // One note each: the order is by name in German.
    expect(counted).toEqual([
      { name: 'Brandschutz', count: 1 },
      { name: 'Feuerschutz', count: 1 },
      { name: 'Stellplätze', count: 1 },
    ])

    const result = await inTenant(() =>
      topics.renameProjectShelfTopic({ projectId, organizationId: ORG, readable: [folderId], from: 'Brandschutz', to: 'Feuerschutz' })
    )
    expect(result).toEqual({ moved: 1 })
  })
})

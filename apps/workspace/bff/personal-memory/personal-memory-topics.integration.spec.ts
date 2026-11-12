/**
 * @vitest-environment node
 */
/**
 * A personal topic is the person’s own (ADR-0180, migration 0237): against a
 * REAL Postgres with the full migration chain, as the restricted runtime role.
 * Removing or renaming a topic as person A never touches person B’s notes on
 * the same topic, in the same organization, even though the service’s WHERE
 * names only A: the row-level security holds the line on its own.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/personal-memory/personal-memory-topics.integration.spec.ts
 *
 * `task db:test:rls` (scripts/rls-test-db.sh) builds that database and runs this file.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/upload-screening/service', () => ({
  maskChatText: vi.fn(async (_organizationId: string, text: string) => ({ text })),
}))

const url = process.env.TEST_DATABASE_URL

const STAMP = Date.now()
const ORG = `org_topics_${STAMP}`
const PERSON_A = `user_a_topics_${STAMP}`
const PERSON_B = `user_b_topics_${STAMP}`
const A = { organizationId: ORG, userId: PERSON_A }
const B = { organizationId: ORG, userId: PERSON_B }

describe('the personal topics suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('personal memory topics against live Postgres', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let service: typeof import('./service')

  const as = <T>(owner: typeof A, run: () => Promise<T>): Promise<T> => withTenant(owner, run)

  /** Each note of the person as its topic column holds it, read with no WHERE on the person. */
  const topicsSeenBy = async (owner: typeof A): Promise<string[]> => {
    const rows = await as(owner, () => db.execute(sql`select coalesce(topic, '-') as topic from personal_memory where organization_id = ${ORG} order by content`))
    return [...rows].map((row) => String(row.topic))
  }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    service = await import('./service')
    await as(A, async () => {
      await service.createPersonalMemoryItem(A, { kind: 'profile', content: 'A: Leads the fire-safety reviews.', provenanceType: 'agent', topic: 'Brandschutz' })
      await service.createPersonalMemoryItem(A, { kind: 'profile', content: 'A: Checks the parking count.', provenanceType: 'agent', topic: 'Stellplätze' })
      await service.createPersonalMemoryItem(A, { kind: 'preference', content: 'A: Answers in short paragraphs.', provenanceType: 'agent' })
    })
    await as(B, () =>
      service.createPersonalMemoryItem(B, { kind: 'profile', content: 'B: Leads the fire-safety reviews too.', provenanceType: 'agent', topic: 'Brandschutz' })
    )
  })

  afterAll(async () => {
    if (!db) return
    await withPlatformAccess('test teardown', async () => {
      await db.execute(sql`delete from personal_memory where organization_id = ${ORG}`)
    })
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('counts a topic over the person’s own notes only, and lists the notes without one as no topic', async () => {
    const topics = await as(A, () => service.listPersonalMemoryTopics(A))
    expect(topics).toEqual([
      { name: 'Brandschutz', count: 1 },
      { name: 'Stellplätze', count: 1 },
    ])
  })

  it('removing a topic deletes the caller’s notes on it and leaves a colleague’s note on the same name', async () => {
    const result = await as(A, () => service.removePersonalMemoryTopic(A, 'brandschutz'))
    expect(result).toEqual({ removed: 1 })
    expect(await topicsSeenBy(B)).toEqual(['Brandschutz'])
  })

  it('renaming a topic moves only the caller’s notes: B’s note keeps its topic', async () => {
    const result = await as(A, () => service.renamePersonalMemoryTopic(A, { from: 'Stellplätze', to: 'Parken' }))
    expect(result).toEqual({ moved: 1 })
    expect(await topicsSeenBy(B)).toEqual(['Brandschutz'])
    expect(await topicsSeenBy(A)).toEqual(['-', 'Parken'])
  })

  it('filters a list to one topic of the caller’s notes, and the empty value to the notes with none', async () => {
    const contentsOf = (owner: typeof A, query: { topic?: string }) =>
      as(owner, async () => {
        const filter = await service.personalListFilter(owner, query)
        const page = await service.listPersonalMemory(owner, { limit: 10, offset: 0 }, filter)
        return page.items.map((item) => item.content)
      })
    expect(await contentsOf(A, { topic: 'parken' })).toEqual(['A: Checks the parking count.'])
    expect(await contentsOf(A, { topic: '' })).toEqual(['A: Answers in short paragraphs.'])
    expect(await contentsOf(B, { topic: 'Parken' })).toEqual([])
  })
})

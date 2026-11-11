/**
 * @vitest-environment node
 */
/**
 * Personal memory is one person's, and the database holds that (ADR-0180):
 * against a REAL Postgres with the full migration chain, connected as the
 * restricted runtime role.
 *
 * The claim is about row-level security, so a mocked handle cannot make it.
 * Person A writes a note through the service. Person B, in the SAME
 * organization, then runs raw statements with no WHERE on the user at all (a
 * colleague's query with the filter forgotten) and reads nothing, updates
 * nothing and deletes nothing; so does anyone in another organization. The
 * note is still A's afterwards. The same cluster shows the unique index on the
 * normalized text, and that a temporary conversation (migration 0226) refuses
 * a memory write while one that is not, or not created yet, does not.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/personal-memory/personal-memory.integration.spec.ts
 *
 * `task db:test:rls` (scripts/rls-test-db.sh) builds that database and runs
 * this file.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// The office's screening is `service.spec.ts`'s subject and reads the
// organization's policy; here a note's text is stored as written.
vi.mock('@/lib/upload-screening/service', () => ({
  maskChatText: vi.fn(async (_organizationId: string, text: string) => ({ text })),
}))

const url = process.env.TEST_DATABASE_URL

const STAMP = Date.now()
const ORG = `org_personal_${STAMP}`
const OTHER_ORG = `org_personal_other_${STAMP}`
const PERSON_A = `user_a_${STAMP}`
const PERSON_B = `user_b_${STAMP}`
const OUTSIDER = `user_outsider_${STAMP}`

const A = { organizationId: ORG, userId: PERSON_A }
const B = { organizationId: ORG, userId: PERSON_B }
const ELSEWHERE = { organizationId: OTHER_ORG, userId: OUTSIDER }
/** The same person id inside another organization: a note is keyed to both. */
const A_ELSEWHERE = { organizationId: OTHER_ORG, userId: PERSON_A }

function rootCause(error: unknown): Error {
  let current = error
  while (current instanceof Error && current.cause) current = current.cause
  return current as Error
}

/**
 * The suite below is opt-in and `describe.skipIf` exits 0 when it skips, which
 * would make a green tenant-isolation job indistinguishable from one that ran
 * nothing. The job sets the marker, so the job that promises a database is the
 * one that fails when it stops providing one.
 */
describe('the personal memory suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(
      url,
      'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set, so the personal memory suite skipped ' +
        'and nothing verified that a colleague cannot read a personal note. Check `task db:test:rls`.'
    ).toBeTruthy()
  })
})

describe.skipIf(!url)('personal memory against live Postgres', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let service: typeof import('./service')
  let repository: typeof import('./repository')
  let temporary: typeof import('@/lib/conversations/temporary')

  type Owner = { organizationId: string; userId: string }
  const as = <T>(owner: Owner, run: () => Promise<T>): Promise<T> => withTenant(owner, run)

  /** Every row of the table as this person's connection sees it: no WHERE at all. */
  const visibleTo = async (owner: Owner): Promise<string[]> => {
    const rows = await as(owner, () => db.execute(sql`select content from personal_memory order by content`))
    return [...rows].map((row) => String(row.content))
  }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    service = await import('./service')
    repository = await import('./repository')
    temporary = await import('@/lib/conversations/temporary')
  })

  afterAll(async () => {
    // `beforeAll` may have thrown before `db` was assigned; a TypeError here
    // would replace the setup failure that is worth reading.
    if (!db) return
    await withPlatformAccess('test teardown', async () => {
      await db.execute(sql`delete from personal_memory where organization_id in (${ORG}, ${OTHER_ORG})`)
      await db.execute(sql`delete from conversations where organization_id in (${ORG}, ${OTHER_ORG})`)
    })
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('shows a note to the person who holds it and to nobody else, with no WHERE on the user', async () => {
    const { item, created } = await as(A, () =>
      service.createPersonalMemoryItem(A, {
        kind: 'preference',
        content: 'Wants answers in short paragraphs.',
        provenanceType: 'agent',
        sourceConversationId: 's_integration',
      })
    )
    expect(created).toBe(true)
    expect(item).toMatchObject({ organizationId: ORG, userId: PERSON_A, provenanceType: 'agent', pinned: false })

    // A, through the service and through a bare select.
    expect((await as(A, () => service.listPersonalMemory(A))).items.map((row) => row.id)).toEqual([item.id])
    expect(await visibleTo(A)).toEqual(['Wants answers in short paragraphs.'])

    // B, a colleague in the same organization: the raw handle, no user filter.
    expect(await visibleTo(B)).toEqual([])
    const byId = await as(B, () => db.execute(sql`select id from personal_memory where id = ${item.id}`))
    expect([...byId]).toEqual([])
    const counted = await as(B, () => db.execute(sql`select count(*)::int as n from personal_memory`))
    expect([...counted][0].n).toBe(0)

    // Anyone in another organization, and A's own id inside another organization.
    expect(await visibleTo(ELSEWHERE)).toEqual([])
    expect(await visibleTo(A_ELSEWHERE)).toEqual([])
  })

  it('lets nobody else update or delete the note, even with a statement that names no user', async () => {
    for (const other of [B, ELSEWHERE, A_ELSEWHERE]) {
      const updated = await as(other, () =>
        db.execute(sql`update personal_memory set content = 'rewritten by somebody else' returning id`)
      )
      expect([...updated], `update as ${other.userId} in ${other.organizationId}`).toEqual([])
      const deleted = await as(other, () => db.execute(sql`delete from personal_memory returning id`))
      expect([...deleted], `delete as ${other.userId} in ${other.organizationId}`).toEqual([])
    }

    // The service asked to act on A's behalf from B's connection finds no row either:
    // an owner a caller names is not enough, the connection has to be that person's.
    const [note] = (await as(A, () => service.listPersonalMemory(A))).items
    expect(await as(B, () => service.listPersonalMemory(A))).toEqual({ items: [], nextCursor: null })
    expect(await as(B, () => service.editPersonalMemoryItem(A, note.id, { pinned: true }))).toBeNull()
    expect(await as(B, () => service.removePersonalMemoryItem(A, note.id))).toBe(false)
    expect(await as(B, () => repository.deleteAllPersonalMemory(A))).toBe(0)
    expect(await as(B, () => service.buildPersonalMemoryDigest(A))).toBeNull()

    expect(await visibleTo(A)).toEqual(['Wants answers in short paragraphs.'])
  })

  it('refuses a row written for somebody else, or into another organization', async () => {
    const insertFor = (connection: Owner, organizationId: string, userId: string) =>
      as(connection, () =>
        db.execute(
          sql`insert into personal_memory (organization_id, user_id, kind, content)
              values (${organizationId}, ${userId}, 'profile', 'planted')`
        )
      ).then(
        () => null,
        (error: unknown) => rootCause(error)
      )

    expect((await insertFor(B, ORG, PERSON_A))?.message).toMatch(/row-level security/i)
    expect((await insertFor(B, OTHER_ORG, PERSON_B))?.message).toMatch(/row-level security/i)
    expect(await visibleTo(A)).toEqual(['Wants answers in short paragraphs.'])
  })

  it('keeps one row per person and normalized text, and lets a colleague hold the same sentence', async () => {
    const again = await as(A, () =>
      service.createPersonalMemoryItem(A, {
        kind: 'preference',
        content: '  WANTS answers in short paragraphs!! ',
        provenanceType: 'distillation',
      })
    )
    expect(again.created).toBe(false)
    expect(await visibleTo(A)).toEqual(['Wants answers in short paragraphs.'])

    // The index itself, past the service's lookup: the race two turns can run.
    const raced = await as(A, () =>
      repository.insertPersonalMemory({ ...A, kind: 'preference', content: 'wants ANSWERS in short paragraphs' })
    ).then(
      () => null,
      (error: unknown) => error
    )
    const { isUniqueViolation } = await import('@/lib/db/errors')
    expect(isUniqueViolation(raced)).toBe(true)

    // The same sentence is B's own note, a second row A never sees.
    const forB = await as(B, () =>
      service.createPersonalMemoryItem(B, {
        kind: 'preference',
        content: 'Wants answers in short paragraphs.',
        provenanceType: 'user',
      })
    )
    expect(forB.created).toBe(true)
    expect(await visibleTo(A)).toHaveLength(1)
    expect(await visibleTo(B)).toHaveLength(1)

    // Editing a second note of A into the first one's text is the 409.
    const second = await as(A, () =>
      service.createPersonalMemoryItem(A, { kind: 'profile', content: 'Leads the fire-safety reviews.', provenanceType: 'agent' })
    )
    await expect(
      as(A, () => service.editPersonalMemoryItem(A, second.item.id, { content: 'wants answers, in short paragraphs' }))
    ).rejects.toMatchObject({ status: 409 })
  })

  it('builds the turn’s block from the person’s own notes only, pinned first', async () => {
    const [profile] = (await as(A, () => service.listPersonalMemory(A))).items.filter((row) => row.kind === 'profile')
    await as(A, () => service.editPersonalMemoryItem(A, profile.id, { pinned: true }))

    const digest = await as(A, () => service.buildPersonalMemoryDigest(A))

    expect(digest).toBe(
      [
        'PERSONAL_MEMORY v1',
        '- [pinned | profile] "Leads the fire-safety reviews."',
        '- [preference] "Wants answers in short paragraphs."',
      ].join('\n')
    )
  })

  it('pages the list in its order, pinned first, with a cursor to the rest', async () => {
    const first = await as(A, () => service.listPersonalMemory(A, { limit: 1, offset: 0 }))
    expect(first.items.map((row) => row.kind)).toEqual(['profile'])
    expect(first.nextCursor).toBe('1')

    const rest = await as(A, () => service.listPersonalMemory(A, { limit: 1, offset: 1 }))
    expect(rest.items.map((row) => row.kind)).toEqual(['preference'])
    expect(rest.nextCursor).toBeNull()
  })

  it('erases every note of one person and leaves the colleague’s', async () => {
    expect(await as(A, () => repository.deleteAllPersonalMemory(A))).toBe(2)
    expect(await visibleTo(A)).toEqual([])
    expect(await visibleTo(B)).toEqual(['Wants answers in short paragraphs.'])
  })

  it('refuses a memory write from a temporary conversation, and from no other (migration 0226)', async () => {
    const TEMPORARY = `s_temporary_${STAMP}`
    const KEPT = `s_kept_${STAMP}`
    await as(A, () =>
      db.execute(
        sql`insert into conversations (id, organization_id, created_by, temporary)
            values (${TEMPORARY}, ${ORG}, ${PERSON_A}, true), (${KEPT}, ${ORG}, ${PERSON_A}, default)`
      )
    )

    await expect(as(A, () => temporary.requireConversationKeepsMemory(TEMPORARY, ORG))).rejects.toMatchObject({
      status: 403,
      code: 'TEMPORARY_CONVERSATION',
    })
    // The column's default keeps memory; so does a row that does not exist yet.
    await expect(as(A, () => temporary.requireConversationKeepsMemory(KEPT, ORG))).resolves.toBeUndefined()
    await expect(as(A, () => temporary.requireConversationKeepsMemory(`s_missing_${STAMP}`, ORG))).resolves.toBeUndefined()
    // Another organization cannot be refused on, or learn of, this one's conversation.
    expect(await as(ELSEWHERE, () => temporary.isTemporaryConversation(TEMPORARY, OTHER_ORG))).toBe(false)
  })
})

/**
 * @vitest-environment node
 *
 * The message page's bounds against a REAL Postgres, through the restricted
 * runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/conversations/message-page.integration.spec.ts
 *
 * What it proves: `until` ends the page before the answer a reader who joined
 * later may not see, together with the `before` cursor, and the answers are
 * listed in the order they were written.
 */
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const STAMP = Date.now()
const ORG = `org_mp_${STAMP}`
const OWNER = `user_mp_${STAMP}`
const url = process.env.TEST_DATABASE_URL

describe('the message page suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('message page bounds against Postgres', () => {
  let repository: typeof import('./repository')
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let conversations: typeof import('@/lib/db/schema/conversations').conversations
  let messages: typeof import('@/lib/db/schema/messages').messages

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    repository = await import('./repository')
    withTenant = (await import('@/lib/db/tenant-context')).withTenant
    db = (await import('@/lib/db')).getDb()
    conversations = (await import('@/lib/db/schema/conversations')).conversations
    messages = (await import('@/lib/db/schema/messages')).messages
  })

  const asOwner = <T>(fn: () => PromiseLike<T>) => withTenant({ organizationId: ORG, userId: OWNER }, fn)

  it('ends the page before the cut, with and without a cursor, and lists the answers in order', async () => {
    const conversationId = `s_mp_${randomUUID()}`
    await asOwner(() => db.insert(conversations).values({ id: conversationId, organizationId: ORG, createdBy: OWNER }))
    const ids = Array.from({ length: 5 }, () => randomUUID())
    const roles = ['user', 'assistant', 'user', 'assistant', 'user'] as const
    await asOwner(() =>
      db.insert(messages).values(
        ids.map((id, index) => ({
          id,
          conversationId,
          organizationId: ORG,
          role: roles[index],
          content: `m${index}`,
          createdAt: new Date(Date.UTC(2026, 10, 24, 10, index)),
        })),
      ),
    )
    const [q1, a1, q2, a2] = ids

    const cut = await asOwner(() => repository.listMessagePage(conversationId, { limit: 50, until: a2 }))
    expect(cut.rows.map((row) => row.id)).toEqual([q1, a1, q2])
    expect(cut.hasMore).toBe(false)

    const paged = await asOwner(() => repository.listMessagePage(conversationId, { limit: 1, before: q2, until: a2 }))
    expect(paged.rows.map((row) => row.id)).toEqual([a1])
    expect(paged.hasMore).toBe(true)

    expect(await asOwner(() => repository.listAnswerIdsInOrder(conversationId, 10))).toEqual([a1, a2])
  })
})

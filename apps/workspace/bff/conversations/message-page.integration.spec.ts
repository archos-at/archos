/**
 * @vitest-environment node
 *
 * The message page's bounds against a REAL Postgres, through the restricted
 * runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/conversations/message-page.integration.spec.ts
 *
 * What it proves: `until` ends the page before the turn a reader who joined
 * later may not see, in the order the server received the messages, so a
 * follow-up with a slow client clock stays withheld; it holds with the
 * `before` cursor; and a batched insert keeps its order (migration 0266).
 */
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'


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

  it('ends the page before the cut in the server’s order, with and without a cursor', async () => {
    const conversationId = `s_mp_${randomUUID()}`
    await asOwner(() => db.insert(conversations).values({ id: conversationId, organizationId: ORG, createdBy: OWNER }))
    const minute = (n: number) => new Date(Date.UTC(2026, 10, 24, 10, n))
    const sent = [
      { role: 'user', at: minute(0) },
      { role: 'assistant', at: minute(1) },
      { role: 'user', at: minute(2) },
      { role: 'assistant', at: minute(3) },
      { role: 'user', at: minute(0) },
    ] as const
    const ids: string[] = []
    for (const [index, message] of sent.entries()) {
      const id = randomUUID()
      ids.push(id)
      await asOwner(() =>
        db.insert(messages).values({ id, conversationId, organizationId: ORG, role: message.role, content: `m${index}`, createdAt: message.at }),
      )
    }
    const [q1, a1, q2, , slowFollowUp] = ids

    const cut = await asOwner(() => repository.listMessagePage(conversationId, { limit: 50, until: q2 }))
    expect(cut.rows.map((row) => row.id)).toEqual([q1, a1])
    expect(cut.rows.map((row) => row.id)).not.toContain(slowFollowUp)

    const paged = await asOwner(() => repository.listMessagePage(conversationId, { limit: 1, before: a1, until: q2 }))
    expect(paged.rows.map((row) => row.id)).toEqual([q1])

    const order = await asOwner(() => repository.listMessageRolesInOrder(conversationId, 10))
    expect(order.map((row) => row.id)).toEqual(ids)
  })

  it('numbers the rows of one batched insert in the order they were sent', async () => {
    const conversationId = `s_mp_${randomUUID()}`
    await asOwner(() => db.insert(conversations).values({ id: conversationId, organizationId: ORG, createdBy: OWNER }))
    const ids = Array.from({ length: 6 }, () => randomUUID())
    await asOwner(() =>
      db.insert(messages).values(
        ids.map((id, index) => ({ id, conversationId, organizationId: ORG, role: index % 2 ? 'assistant' : 'user', content: `m${index}` })),
      ),
    )
    const order = await asOwner(() => repository.listMessageRolesInOrder(conversationId, 10))
    expect(order.map((row) => row.id)).toEqual(ids)
  })
})

/**
 * @vitest-environment node
 *
 * Admitting a read of the owner's own shelf (ADR-0193 rule 5, migration 0264)
 * against a REAL Postgres, through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/conversations/personal-shelf-use.integration.spec.ts
 *
 * What it proves: only the owner's collection is admitted, only under a
 * decision that allows it, only while the chat is the owner's alone; an
 * admission marks the chat and the answer's record, and a refusal marks
 * neither.
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { closedContext } from '@/lib/conversation-context/context.fixtures'
import { decisionOf } from '@/lib/conversation-context/wire'

vi.mock('server-only', () => ({}))

const STAMP = Date.now()
const ORG = `org_psu_${STAMP}`
const OWNER = `user_psu_${STAMP}`
const url = process.env.TEST_DATABASE_URL

describe('the personal shelf use suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('personal shelf use against Postgres (migration 0264)', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let use: typeof import('./personal-shelf-use')
  let record: typeof import('@/lib/conversation-context/record')
  let conversations: typeof import('@/lib/db/schema/conversations').conversations
  let answerContexts: typeof import('@/lib/db/schema/answer-contexts').answerContexts
  let own: string

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    withTenant = (await import('@/lib/db/tenant-context')).withTenant
    db = (await import('@/lib/db')).getDb()
    use = await import('./personal-shelf-use')
    record = await import('@/lib/conversation-context/record')
    conversations = (await import('@/lib/db/schema/conversations')).conversations
    answerContexts = (await import('@/lib/db/schema/answer-contexts')).answerContexts
    own = (await import('@/lib/personal-shelf/collection')).personalShelfCollectionName(ORG, OWNER)
  })

  const asOwner = <T>(fn: () => PromiseLike<T>) => withTenant({ organizationId: ORG, userId: OWNER }, fn)
  const chat = async (visibility: 'private' | 'organization' = 'private', subject = false) => {
    const id = `s_psu_${randomUUID()}`
    const thread = subject ? { subjectResourceType: 'document' as const, subjectResourceId: randomUUID() } : {}
    await asOwner(() => db.insert(conversations).values({ id, organizationId: ORG, createdBy: OWNER, visibility, ...thread }))
    return id
  }
  const allowing = (conversationId: string, answer: string | null, userId = OWNER) => {
    const context = closedContext('chat', conversationId)
    return decisionOf(
      { ...context, audience: { ...context.audience, solo: true, version: 0 }, may: { ...context.may, personalShelf: true } },
      { organizationId: ORG, userId },
      answer,
      Date.now(),
    )
  }
  const usedAt = (conversationId: string) =>
    asOwner(() =>
      db
        .select({ usedAt: conversations.personalShelfUsedAt })
        .from(conversations)
        .where(and(eq(conversations.organizationId, ORG), eq(conversations.id, conversationId))),
    ).then(([row]) => row?.usedAt ?? null)

  it('admits the owner’s own shelf in their solo chat, and marks the chat and the answer', async () => {
    const conversationId = await chat()
    const answer = randomUUID()
    const decision = allowing(conversationId, answer)
    expect(await asOwner(() => record.recordDecidedAnswer(decision, null))).toBe(true)

    const admitted = await asOwner(() =>
      use.admitPersonalShelf({ organizationId: ORG, conversationId, userId: OWNER, answerMessageId: answer }, [own], decision),
    )

    expect(admitted).toEqual([own])
    expect(await usedAt(conversationId)).not.toBeNull()
    expect(await asOwner(() => use.personalShelfUsed(ORG, conversationId))).toBe(true)
    const [row] = await asOwner(() =>
      db
        .select({ read: answerContexts.readPersonalShelf })
        .from(answerContexts)
        .where(and(eq(answerContexts.organizationId, ORG), eq(answerContexts.messageId, answer))),
    )
    expect(row?.read).toBe(true)
  })

  it('refuses a chat others read, a decision that does not allow it, another person’s shelf, and marks nothing', async () => {
    const shared = await chat('organization')
    const solo = await chat()
    const request = (conversationId: string) => ({ organizationId: ORG, conversationId, userId: OWNER })
    const closed = decisionOf(closedContext('chat', solo), { organizationId: ORG, userId: OWNER }, null, Date.now())
    const colleagues = own.replace(OWNER, `${OWNER}_colleague`)

    expect(await asOwner(() => use.admitPersonalShelf(request(shared), [own], allowing(shared, null)))).toEqual([])
    expect(await asOwner(() => use.admitPersonalShelf(request(solo), [own], closed))).toEqual([])
    expect(await asOwner(() => use.admitPersonalShelf(request(solo), [own], null))).toEqual([])
    expect(await asOwner(() => use.admitPersonalShelf(request(solo), [own], allowing(solo, null, `${OWNER}_colleague`)))).toEqual([])
    expect(await asOwner(() => use.admitPersonalShelf(request(solo), [colleagues], allowing(solo, null)))).toEqual([])
    expect(await usedAt(shared)).toBeNull()
    expect(await usedAt(solo)).toBeNull()
  })

  it('refuses a document thread, whose answers reach the document's readers as annotation replies', async () => {
    const thread = await chat('private', true)
    const admitted = await asOwner(() =>
      use.admitPersonalShelf({ organizationId: ORG, conversationId: thread, userId: OWNER }, [own], allowing(thread, null)),
    )
    expect(admitted).toEqual([])
    expect(await usedAt(thread)).toBeNull()
  })

  it('refuses a chat that has no row yet, since there is nowhere to record the use', async () => {
    const conversationId = `s_psu_${randomUUID()}`
    const admitted = await asOwner(() =>
      use.admitPersonalShelf({ organizationId: ORG, conversationId, userId: OWNER }, [own], allowing(conversationId, null)),
    )
    expect(admitted).toEqual([])
  })
})

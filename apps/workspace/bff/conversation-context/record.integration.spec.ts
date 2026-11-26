/**
 * @vitest-environment node
 *
 * The per-answer record (ADR-0194, migration 0261) against a REAL Postgres,
 * through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/conversation-context/record.integration.spec.ts
 *
 * What it proves: a decision writes one row per answer; a second decision for
 * the same answer id from another conversation does not re-point that row;
 * what a turn read is merged without duplicates; another organization sees
 * nothing of it.
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { closedContext } from './context.fixtures'
import { decisionOf } from './wire'


const STAMP = Date.now()
const ORG = `org_ac_${STAMP}`
const OTHER_ORG = `${ORG}_other`
const USER = `user_ac_${STAMP}`
const url = process.env.TEST_DATABASE_URL

describe('the per-answer record suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('answer_contexts against Postgres (migration 0261)', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let record: typeof import('./record')
  let schema: typeof import('@/lib/db/schema/answer-contexts')

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    withTenant = (await import('@/lib/db/tenant-context')).withTenant
    db = (await import('@/lib/db')).getDb()
    record = await import('./record')
    schema = await import('@/lib/db/schema/answer-contexts')
  })

  const inOrg = <T>(organizationId: string, fn: () => PromiseLike<T>) => withTenant({ organizationId, userId: USER }, fn)
  const rowOf = (organizationId: string, messageId: string) =>
    inOrg(organizationId, () =>
      db
        .select()
        .from(schema.answerContexts)
        .where(and(eq(schema.answerContexts.organizationId, organizationId), eq(schema.answerContexts.messageId, messageId))),
    )

  it('writes one row per answer, keeps it and its reads to its conversation, and merges what the turn read', async () => {
    const answer = randomUUID()
    const context = closedContext('chat', 's_ac_1')
    const asker = { organizationId: ORG, userId: USER }
    const decided = decisionOf({ ...context, audience: { ...context.audience, solo: true, version: 3 } }, asker, answer, Date.now())
    const elsewhere = decisionOf(closedContext('chat', 's_ac_other'), asker, answer, Date.now())
    expect(await inOrg(ORG, () => record.recordDecidedAnswer(decided, null))).toBe(true)
    expect(await inOrg(ORG, () => record.recordDecidedAnswer(elsewhere, null))).toBe(false)
    expect(await inOrg(ORG, () => record.recordDecidedAnswer(decisionOf(context, asker, null, Date.now()), null))).toBe(false)
    await inOrg(ORG, () => record.recordAnswerReads(db, ORG, 's_ac_1', answer, { folders: ['f2', 'f1'], projects: ['p1'] }))
    await inOrg(ORG, () => record.recordAnswerReads(db, ORG, 's_ac_1', answer, { folders: ['f1'], projects: [] }))
    await inOrg(ORG, () => record.recordAnswerReads(db, ORG, 's_ac_other', answer, { folders: ['f_elsewhere'], projects: ['p_elsewhere'] }))

    const [row] = await rowOf(ORG, answer)
    expect(row).toMatchObject({
      conversationId: 's_ac_1',
      kind: 'chat',
      audienceVersion: 3,
      solo: true,
      workspaceRead: 'none',
      readFolders: ['f1', 'f2'],
      readProjects: ['p1'],
    })
    expect(await inOrg(OTHER_ORG, () => db.select().from(schema.answerContexts).where(eq(schema.answerContexts.messageId, answer)))).toEqual([])
  })

  it('writes the record of a headless turn in its conversation, under its kind', async () => {
    const answer = randomUUID()
    const context = closedContext('headless', 's_ac_check')
    const headless = { ...context, may: { ...context.may, workspaceRead: 'document+projectFacts' as const } }
    const project = randomUUID()
    expect(await inOrg(ORG, () => record.recordDecidedAnswer(decisionOf(headless, { organizationId: ORG, userId: USER }, answer, Date.now()), project))).toBe(true)

    const [row] = await rowOf(ORG, answer)
    expect(row).toMatchObject({ conversationId: 's_ac_check', kind: 'headless', workspaceRead: 'document+projectFacts', projectId: project })
  })
})

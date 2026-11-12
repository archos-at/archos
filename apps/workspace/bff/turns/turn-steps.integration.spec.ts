/**
 * @vitest-environment node
 *
 * A turn nobody watched keeps its Herleitung, against a REAL Postgres through
 * the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/turns/turn-steps.integration.spec.ts
 *
 * `task db:test:rls` (scripts/rls-test-db.sh) builds that database and runs it.
 *
 * The question is written as the agent door writes it (`askAgent`: a user row
 * under the turn's id, `agentConsult` in its metadata), and no browser ever
 * stores steps. The agent tier's hand-over (`recordTurnSteps`, what
 * `PUT …/messages/{turnId}/steps` runs) then leaves the question with the rows
 * the asker's browser would have stored, and a reload of the thread
 * (`include=steps`, the page `conversation-message-list` reads) returns them.
 * A browser that stored them too leaves one copy, and another organization
 * writes nothing.
 */

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { wireFixtureLines } from '@/test-utils/wire-v2-fixtures'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const STAMP = Date.now()
const ORG = `org_steps_${STAMP}`
const OTHER_ORG = `${ORG}_other`
const ANNA = `user_steps_anna_${STAMP}`
const THREAD = `s_${randomUUID().replace(/-/g, '_')}`
const QUESTION = randomUUID()
const ANSWER = randomUUID()

/** A recorded turn with steps, steers and subagents, re-addressed to this thread's question. */
const FRAMES = wireFixtureLines<Record<string, unknown>>('turn-subagents.jsonl').map((frame) => ({
  ...frame,
  conversation_id: THREAD,
  turn_id: QUESTION,
}))

describe.skipIf(!url)('a turn’s Herleitung, stored by the server', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let as: <T>(organizationId: string, run: () => Promise<T>) => Promise<T>
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let repo: typeof import('@/lib/conversations/repository')
  let steps: typeof import('./turn-steps')
  let view: typeof import('@/lib/conversations/message-view')

  /** The thread as a reload reads it, with the steps asked for. */
  const reloadedQuestion = async (): Promise<StoredThinkingStep[] | undefined> => {
    const page = await as(ORG, () => repo.listMessagePage(THREAD, { limit: 50 }))
    const row = page.rows.find((message) => message.id === QUESTION)!
    const shown = view.toMessageView(row, new Map(), view.parseMessageIncludes('steps'))
    const provenance = shown.metadata?.provenance as { thinkingSteps?: StoredThinkingStep[] } | undefined
    return provenance?.thinkingSteps
  }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    as = (organizationId, run) => context.withTenant({ organizationId, userId: null }, run)
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    repo = await import('@/lib/conversations/repository')
    steps = await import('./turn-steps')
    view = await import('@/lib/conversations/message-view')
    await as(ORG, async () => {
      await db.execute(sql`INSERT INTO conversations (id, organization_id, created_by) VALUES (${THREAD}, ${ORG}, ${ANNA})`)
      await repo.insertMessages([
        {
          id: QUESTION,
          conversationId: THREAD,
          role: 'user',
          authorUserId: ANNA,
          content: 'Wie hoch muss das Geländer sein?',
          metadata: { messageType: 'user', agentConsult: { askId: QUESTION } },
        },
        { id: ANSWER, conversationId: THREAD, role: 'assistant', content: 'Mindestens 1,00 m.', metadata: {} },
      ])
    })
  })

  afterAll(async () => {
    await withPlatformAccess('turn steps spec cleanup', () =>
      db.execute(sql`DELETE FROM conversations WHERE organization_id IN (${ORG}, ${OTHER_ORG})`)
    )
  })

  it('reloads a door-asked question with the steps the asker’s browser would have stored', async () => {
    expect(await reloadedQuestion()).toBeUndefined()
    const browser = steps.foldedTurnSteps(THREAD, QUESTION, FRAMES)
    expect(browser.length).toBeGreaterThan(0)

    const written = await as(ORG, () => steps.recordTurnSteps(ORG, THREAD, QUESTION, FRAMES))

    expect(written.stored).toBe(browser.length)
    expect(await reloadedQuestion()).toEqual(browser)
    const [row] = await as(ORG, () => repo.listMessagePage(THREAD, { limit: 50 })).then((page) =>
      page.rows.filter((message) => message.id === QUESTION)
    )
    // The rest of the question's metadata is kept: the door's mark still says who asked.
    expect(row!.metadata).toMatchObject({ agentConsult: { askId: QUESTION } })
  })

  it('leaves one copy when the browser stored the steps too, in either order', async () => {
    const browser = steps.foldedTurnSteps(THREAD, QUESTION, FRAMES)
    // The browser's PATCH (`updateMessageDetail`): the provenance replaced whole.
    await as(ORG, () => repo.mergeMessageMetadata(THREAD, QUESTION, { provenance: { thinkingSteps: browser } }))
    await as(ORG, () => steps.recordTurnSteps(ORG, THREAD, QUESTION, FRAMES))
    await as(ORG, () => steps.recordTurnSteps(ORG, THREAD, QUESTION, FRAMES))

    expect(await reloadedQuestion()).toEqual(browser)
  })

  it('writes nothing for another organization, nor onto an answer', async () => {
    await expect(as(OTHER_ORG, () => steps.recordTurnSteps(OTHER_ORG, THREAD, QUESTION, FRAMES))).rejects.toThrow()
    await expect(as(ORG, () => steps.recordTurnSteps(ORG, THREAD, ANSWER, FRAMES))).rejects.toThrow()
  })
})

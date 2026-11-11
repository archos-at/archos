/**
 * @vitest-environment node
 */
/**
 * Opt-in integration test: the `conversation-trace-erasure` sweep against a
 * REAL Postgres with every migration applied, as the restricted runtime role.
 * Langfuse is doubled; the queue, the conversations and the legal holds are not.
 *
 * The unit suite (`workers/maintenance-sql.spec.mjs`) reads the SQL's text.
 * Only this can prove what it selects: that a chat the purger erased, whose
 * trace step then failed up to the attempt cap, still has its traces erased
 * although its row reads `failed`; and that a `failed` row whose chat still
 * exists, or is under a legal hold, keeps them.
 *
 *   bash scripts/rls-test-db.sh --only bff/scheduling/conversation-trace-erasure.integration.spec.ts
 */

import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL

const eraseSessionTraces = vi.fn(async (_client: unknown, _sessionId: string) => ({ traces: 1, batches: 1 }))
vi.mock('../../workers/langfuse-traces.js', () => ({
  createTraceClient: () => ({}),
  deleteTracesBefore: vi.fn(),
  eraseSessionTraces: (client: unknown, sessionId: string) => eraseSessionTraces(client, sessionId),
  readLangfuseConfig: () => ({ config: { host: 'http://langfuse.test' }, missing: [] }),
  readTraceRetentionDays: () => ({ days: 30 }),
}))

// The sweep's own client, so the suite can close it.
let client: ReturnType<typeof postgres>
vi.mock('../../workers/app-database.js', () => ({ createSql: () => client }))

const STAMP = Date.now()
const ORG = `org_traces_${STAMP}`
const USER = `user_traces_${STAMP}`
const chat = {
  /** Erased by the BFF; the purger's trace step failed up to the cap. */
  gone: `s_traces_gone_${STAMP}`,
  /** The BFF's erasure itself failed up to the cap: the chat is still there, marked deleting. */
  present: `s_traces_present_${STAMP}`,
  /** Erased, trace step failed, and a legal hold on the chat since. */
  held: `s_traces_held_${STAMP}`,
  /** Erased by the delete request, which closed its own row. */
  purged: `s_traces_purged_${STAMP}`,
  /** Erased, failed a minute ago: a turn may still be exporting spans. */
  fresh: `s_traces_fresh_${STAMP}`,
}
const OURS = new Set(Object.values(chat))

type QueueRow = { status: string; stamped: boolean; purged_at: Date | null; last_error: string | null }

describe.skipIf(!url)('conversation trace erasure sweep against live Postgres', () => {
  let sweepConversationTraces: typeof import('./sweeps').sweepConversationTraces

  const asPlatform = <T>(run: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
    client.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE app_platform')
      return run(tx)
    }) as Promise<T>

  async function queueRow(entityId: string): Promise<QueueRow> {
    const rows = await asPlatform(
      (tx) => tx<QueueRow[]>`
        SELECT status, payload->>'langfuseTracesErasedAt' IS NOT NULL AS stamped, purged_at, last_error
        FROM deletion_queue WHERE entity_type = 'conversation' AND entity_id = ${entityId}`,
    )
    return rows[0]
  }

  const failed = (tx: postgres.TransactionSql, entityId: string, lastClaim: string) => tx`
    INSERT INTO deletion_queue
      (entity_type, entity_id, display_name, organization_id, requested_by, purge_after, status, attempts, claimed_at, last_error)
    VALUES ('conversation', ${entityId}, 'Chat', ${ORG}, ${USER}, now() - interval '1 day', 'failed', 10,
            now() - ${lastClaim}::interval, 'Langfuse answered 503')`

  /** The chats of this suite the sweep asked Langfuse about. */
  const erased = () => eraseSessionTraces.mock.calls.map(([, sessionId]) => sessionId).filter((id) => OURS.has(id))

  beforeAll(async () => {
    client = postgres(url as string, { prepare: false, max: 2 })
    ;({ sweepConversationTraces } = await import('./sweeps'))
    await asPlatform(async (tx) => {
      await tx`INSERT INTO organizations (workos_organization_id, display_name) VALUES (${ORG}, ${ORG}) ON CONFLICT DO NOTHING`
      await tx`
        INSERT INTO conversations (id, organization_id, created_by, title, deleted_at)
        VALUES (${chat.present}, ${ORG}, ${USER}, 'Half erased', now())`
    })
  })

  beforeEach(async () => {
    eraseSessionTraces.mockClear()
    await asPlatform(async (tx) => {
      await tx`DELETE FROM legal_holds WHERE organization_id = ${ORG}`
      await tx`DELETE FROM deletion_queue WHERE organization_id = ${ORG}`
      await failed(tx, chat.gone, '1 hour')
      await failed(tx, chat.present, '1 hour')
      await failed(tx, chat.held, '1 hour')
      await failed(tx, chat.fresh, '1 minute')
      await tx`
        INSERT INTO deletion_queue
          (entity_type, entity_id, display_name, organization_id, requested_by, purge_after, status, purged_at)
        VALUES ('conversation', ${chat.purged}, 'Chat', ${ORG}, ${USER}, now() - interval '1 day', 'purged', now() - interval '1 hour')`
      await tx`
        INSERT INTO legal_holds (entity_type, entity_id, organization_id, reason, created_by)
        VALUES ('conversation', ${chat.held}, ${ORG}, 'integration test', ${USER})`
    })
  })

  afterAll(async () => {
    if (!client) return
    await asPlatform(async (tx) => {
      await tx`DELETE FROM legal_holds WHERE organization_id = ${ORG}`
      await tx`DELETE FROM deletion_queue WHERE organization_id = ${ORG}`
      await tx`DELETE FROM conversations WHERE organization_id = ${ORG}`
      await tx`DELETE FROM organizations WHERE workos_organization_id = ${ORG}`
    })
    await client.end()
  })

  it('erases the traces of a chat that is gone although its row ended failed, stamps it and closes it purged', async () => {
    await sweepConversationTraces()

    expect(erased()).toContain(chat.gone)
    const row = await queueRow(chat.gone)
    expect(row).toMatchObject({ status: 'purged', stamped: true, last_error: null })
    expect(row.purged_at).toBeInstanceOf(Date)

    // Done once: the next run does not ask Langfuse again.
    eraseSessionTraces.mockClear()
    await sweepConversationTraces()
    expect(erased()).toEqual([])
  })

  it('does not touch a failed row whose chat still exists', async () => {
    await sweepConversationTraces()

    expect(erased()).not.toContain(chat.present)
    expect(await queueRow(chat.present)).toMatchObject({ status: 'failed', stamped: false, last_error: 'Langfuse answered 503' })
  })

  it('does not touch a failed row under a legal hold, and goes back for it once the hold is released', async () => {
    await sweepConversationTraces()

    expect(erased()).not.toContain(chat.held)
    expect(await queueRow(chat.held)).toMatchObject({ status: 'failed', stamped: false })

    await asPlatform((tx) => tx`UPDATE legal_holds SET released_at = now() WHERE organization_id = ${ORG}`)
    await sweepConversationTraces()
    expect(erased()).toContain(chat.held)
    expect(await queueRow(chat.held)).toMatchObject({ status: 'purged', stamped: true })
  })

  it('leaves a failed row alone until its last attempt has settled', async () => {
    await sweepConversationTraces()

    expect(erased()).not.toContain(chat.fresh)
    expect(await queueRow(chat.fresh)).toMatchObject({ status: 'failed', stamped: false })
  })

  it('treats a purged row as before: traces erased, stamped, the row otherwise unchanged', async () => {
    const before = await queueRow(chat.purged)

    await sweepConversationTraces()

    expect(erased()).toContain(chat.purged)
    const after = await queueRow(chat.purged)
    expect(after).toMatchObject({ status: 'purged', stamped: true })
    expect(after.purged_at).toEqual(before.purged_at)
  })

  it('keeps a failed row failed, and unstamped, when Langfuse refuses', async () => {
    eraseSessionTraces.mockImplementation(async (_client, sessionId) => {
      if (sessionId === chat.gone) throw new Error('Langfuse answered 503')
      return { traces: 0, batches: 0 }
    })
    try {
      await expect(sweepConversationTraces()).rejects.toThrow('Langfuse answered 503')
    } finally {
      eraseSessionTraces.mockImplementation(async () => ({ traces: 1, batches: 1 }))
    }
    expect(await queueRow(chat.gone)).toMatchObject({ status: 'failed', stamped: false })
  })
})

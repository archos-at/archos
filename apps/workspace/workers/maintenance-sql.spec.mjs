/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  conversationIsHeld,
  findConversationsAwaitingTraceErasure,
  markConversationTracesErased,
  pruneDownloadLog,
  pruneOldRuns,
  PLATFORM_ROLE,
  PRUNE_BATCH,
} from './maintenance-sql.js'

// Same fake-sql idiom as purger/db.spec.mjs: a tagged-template fn that records
// the rendered SQL text (`join('$')` renders each interpolation as `$`) plus the
// bound values in order. Both entry points run inside `sql.begin`, so the fake
// `sql` exposes `.begin(cb)` and invokes cb with the recording tx template.
//
// The tx also records `.unsafe()` calls: every transaction must step up to the
// BYPASSRLS role before it queries, because these sweeps span tenants
// and row-level security would otherwise hide every other organization's rows (ADR-0041).
function makeTx(executed, respond) {
  const tx = (strings, ...values) => {
    const text = strings.join('$').replace(/\s+/g, ' ').trim()
    executed.push({ text, values })
    return Promise.resolve(respond(text))
  }
  tx.unsafe = (text) => {
    executed.push({ text, values: [] })
    return Promise.resolve([])
  }
  return tx
}

/** A transaction whose SELECT answers `selectRows` and whose other statements answer nothing. */
function makeSelectSql(selectRows) {
  const executed = []
  const tx = makeTx(executed, (text) => (/^SELECT/i.test(text) ? selectRows : []))
  return { sql: { begin: (cb) => cb(tx) }, executed }
}

// Each DELETE returns the next array from `sequence`; a short final batch ends
// the loop. One transaction per batch, so `begin` is called per iteration.
function makePruneSql(sequence) {
  const executed = []
  let i = 0
  const tx = makeTx(executed, () => {
    const rows = sequence[i] ?? []
    i += 1
    return rows
  })
  return { sql: { begin: (cb) => cb(tx) }, executed }
}

/** The statements a transaction ran, excluding the platform step-up. */
function queries(executed) {
  return executed.filter((q) => !q.text.startsWith('SET LOCAL ROLE'))
}

describe('pruneOldRuns', () => {
  it('deletes older rows in batches until a short batch, summing the total', async () => {
    const fullBatch = Array.from({ length: PRUNE_BATCH }, (_, i) => ({ id: `r${i}` }))
    const shortBatch = [{ id: 'x' }, { id: 'y' }, { id: 'z' }]
    const { sql, executed } = makePruneSql([fullBatch, shortBatch])

    const total = await pruneOldRuns(sql, 90)

    expect(total).toBe(PRUNE_BATCH + 3)
    expect(queries(executed)).toHaveLength(2) // looped once more after the full batch

    const del = queries(executed)[0]
    expect(del.text).toMatch(/^DELETE FROM task_runs/)
    expect(del.text).toContain('make_interval(days => $)')
    expect(del.text).toContain('LIMIT $')
    expect(del.text).toContain('RETURNING id')
    expect(del.values).toEqual([90, PRUNE_BATCH]) // retentionDays, batch limit
  })

  it('stops after a single sub-batch delete and returns its count', async () => {
    const { sql, executed } = makePruneSql([[{ id: 'a' }, { id: 'b' }]])
    const total = await pruneOldRuns(sql, 30)
    expect(total).toBe(2)
    expect(queries(executed)).toHaveLength(1)
    expect(queries(executed)[0].values).toEqual([30, PRUNE_BATCH])
  })

  it('returns 0 when nothing is old enough', async () => {
    const { sql, executed } = makePruneSql([[]])
    expect(await pruneOldRuns(sql, 90)).toBe(0)
    expect(queries(executed)).toHaveLength(1)
  })
})

/**
 * Losing the step-up would not fail loudly: row-level security would simply
 * hide every other tenant's rows, and the sweeps would go quiet while
 * reporting healthy runs. These assertions are
 * the only thing standing between that and a silent outage (ADR-0041).
 */
describe('platform scope', () => {
  it('steps up in every prune batch, since each is its own transaction', async () => {
    const fullBatch = Array.from({ length: PRUNE_BATCH }, (_, i) => ({ id: `r${i}` }))
    const { sql, executed } = makePruneSql([fullBatch, [{ id: 'x' }]])

    await pruneOldRuns(sql, 90)

    const stepUps = executed.filter((q) => q.text === `SET LOCAL ROLE ${PLATFORM_ROLE}`)
    expect(stepUps).toHaveLength(2)
    // …and each one precedes its own DELETE rather than all landing up front.
    expect(executed.map((q) => (q.text.startsWith('SET LOCAL ROLE') ? 'role' : 'query'))).toEqual([
      'role',
      'query',
      'role',
      'query',
    ])
  })
})

describe('conversation trace erasure queries', () => {
  it('finds purged conversation rows that are recent, settled, unstamped and not held', async () => {
    const { sql, executed } = makeSelectSql([{ id: 'q1', entity_id: 's_1', organization_id: 'org_1' }])

    const rows = await findConversationsAwaitingTraceErasure(sql, 100)

    expect(rows).toEqual([{ id: 'q1', entity_id: 's_1', organization_id: 'org_1' }])
    const [step, select] = executed
    expect(step.text).toBe(`SET LOCAL ROLE ${PLATFORM_ROLE}`)
    expect(select.text).toContain("q.entity_type = 'conversation'")
    expect(select.text).toContain("q.status = 'purged'")
    expect(select.text).toContain('q.purged_at >= now() - make_interval(days => $)')
    expect(select.text).toContain('q.purged_at <= now() - make_interval(mins => $)')
    expect(select.text).toContain("q.payload->>'langfuseTracesErasedAt' IS NULL")
    expect(select.text).toContain('NOT legal_hold_blocks(q.entity_type, q.entity_id, q.organization_id)')
    // 35 days, 15 minutes, 100 rows.
    expect(select.values).toEqual([35, 15, 100])
  })

  it('asks the hold predicate about the one conversation before its traces go', async () => {
    const { sql, executed } = makeSelectSql([{ held: true }])
    expect(await conversationIsHeld(sql, { entity_id: 's_1', organization_id: 'org_1' })).toBe(true)
    expect(executed[1].text).toContain("legal_hold_blocks('conversation', $, $)")
    expect(executed[1].values).toEqual(['s_1', 'org_1'])

    const free = makeSelectSql([{ held: false }])
    expect(await conversationIsHeld(free.sql, { entity_id: 's_1', organization_id: 'org_1' })).toBe(false)
  })

  it('stamps the queue row through a jsonb merge that survives a missing or non-object payload', async () => {
    const { sql, executed } = makeSelectSql([])
    await markConversationTracesErased(sql, 'q1')
    const update = executed.find((q) => q.text.startsWith('UPDATE deletion_queue'))
    expect(update.text).toContain("jsonb_build_object('langfuseTracesErasedAt', now())")
    expect(update.text).toContain("jsonb_typeof(payload) = 'object'")
    expect(update.text).toContain('WHERE id = $')
    expect(update.values).toEqual(['q1'])
    expect(executed[0].text).toBe(`SET LOCAL ROLE ${PLATFORM_ROLE}`)
  })
})

describe('pruneDownloadLog (retention of the download log, migration 0114)', () => {
  /** A fake whose DELETEs answer from per-scope queues and whose organization list is fixed. */
  function makeLogSql({ global = [], perOrg = {}, organizations = [] }) {
    const executed = []
    const queues = { global: [...global], ...Object.fromEntries(Object.entries(perOrg).map(([k, v]) => [k, [...v]])) }
    const tx = makeTx(executed, (text) => {
      if (text.startsWith('SELECT workos_organization_id')) return organizations
      if (!text.startsWith('DELETE FROM document_access_log')) return []
      const org = text.includes('organization_id = $')
        ? executed[executed.length - 1].values[0]
        : 'global'
      return (queues[org] ?? []).shift() ?? []
    })
    return { sql: { begin: (cb) => cb(tx) }, executed }
  }
  const full = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }))

  it('deletes everything past twelve months for every organization, and only that when no organization chose less', async () => {
    const { sql, executed } = makeLogSql({ global: [full(3)] })

    const result = await pruneDownloadLog(sql, { batch: 1000 })

    expect(result).toEqual({ deleted: 3, capped: false })
    const deletes = queries(executed).filter((q) => q.text.startsWith('DELETE FROM document_access_log'))
    expect(deletes).toHaveLength(1)
    expect(deletes[0].text).toContain('occurred_at < now() - make_interval(days => $)')
    expect(deletes[0].text).not.toContain('organization_id')
    expect(deletes[0].values).toEqual([365, 1000])
  })

  it('applies an organization’s shorter retention to that organization alone', async () => {
    const { sql, executed } = makeLogSql({
      organizations: [{ organization_id: 'org_90', days: 90 }],
      perOrg: { org_90: [full(2)] },
    })

    const result = await pruneDownloadLog(sql, { batch: 1000 })

    expect(result).toEqual({ deleted: 2, capped: false })
    const own = queries(executed).find((q) => q.text.includes('organization_id = $'))
    expect(own.values).toEqual(['org_90', 90, 1000])
  })

  it('selects only valid shorter settings, guarding the cast, and never one longer than the cap', async () => {
    const { sql, executed } = makeLogSql({})
    await pruneDownloadLog(sql)

    const select = queries(executed).find((q) => q.text.startsWith('SELECT workos_organization_id'))
    expect(select.text).toContain("WHEN settings->>'downloadLogRetentionDays' ~ '^[0-9]{1,4}$' THEN")
    expect(select.text).toContain('BETWEEN $ AND $')
    expect(select.values).toEqual([30, 364])
  })

  it('works in bounded batches and stops on its budget, saying more may remain', async () => {
    const { sql, executed } = makeLogSql({ global: [full(2), full(2), full(2), full(2)] })

    const result = await pruneDownloadLog(sql, { batch: 2, maxBatches: 3 })

    expect(result).toEqual({ deleted: 6, capped: true })
    expect(queries(executed).filter((q) => q.text.startsWith('DELETE'))).toHaveLength(3)
  })

  it('steps up to the platform role in every transaction: the table refuses any other delete', async () => {
    const { sql, executed } = makeLogSql({ organizations: [{ organization_id: 'org_90', days: 90 }] })
    await pruneDownloadLog(sql)

    const steps = executed.filter((q) => q.text === `SET LOCAL ROLE ${PLATFORM_ROLE}`)
    const statements = queries(executed)
    expect(steps).toHaveLength(statements.length)
  })
})

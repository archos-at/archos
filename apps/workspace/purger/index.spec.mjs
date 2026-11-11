/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPurger } from './index.js'
import { createFailureStreak, escalationTicks } from '../workers/failure-streak.js'

afterEach(() => {
  vi.restoreAllMocks()
})

/** The purger's default 60 s poll: five ticks is five minutes. */
const ESCALATE_AFTER = escalationTicks(60000)

/** A `postgres` client whose every transaction fails the way a restart does (#802, #803). */
function unreachable(code = 'EHOSTUNREACH') {
  const down = Object.assign(new Error(`connect ${code} 10.111.223.83:5432 - Local (0.0.0.0:0)`), { code })
  return { begin: vi.fn().mockRejectedValue(down) }
}

/** A reachable database with an empty queue: the reap and the claim both find nothing. */
function reachable() {
  const tx = Object.assign(() => Promise.resolve([]), { unsafe: () => Promise.resolve([]) })
  return { begin: vi.fn((cb) => cb(tx)) }
}

function purgerOver(sql, streak) {
  // The deps are never reached: no row is ever claimed.
  return createPurger({ sql, deps: /** @type {never} */ ({}), streak })
}

function spies() {
  return {
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  }
}

describe('purger tick during a database outage', () => {
  it('logs an unreachable database at WARN, once per tick, not the reap and the claim at ERROR', async () => {
    const { error, warn } = spies()
    const streak = createFailureStreak({ label: '[purger] queue', escalateAfter: ESCALATE_AFTER })

    await purgerOver(unreachable(), streak).tick()

    expect(error).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('[purger] queue failed (database unavailable (EHOSTUNREACH))')
  })

  it('escalates to ONE error after five failed ticks, and logs the recovery', async () => {
    const { error, log } = spies()
    const streak = createFailureStreak({ label: '[purger] queue', escalateAfter: ESCALATE_AFTER })
    const down = purgerOver(unreachable('57P03'), streak)

    for (let i = 0; i < 4; i += 1) await down.tick()
    expect(error).not.toHaveBeenCalled()
    for (let i = 0; i < 4; i += 1) await down.tick()
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toBe(
      '[purger] queue still failing after 5 consecutive ticks: database unavailable (57P03)',
    )

    await purgerOver(reachable(), streak).tick()
    expect(log).toHaveBeenCalledWith('[purger] queue recovered after 8 failed ticks')
    expect(streak.count()).toBe(0)
  })

  it('keeps a claim that failed for any other reason at ERROR', async () => {
    const { error } = spies()
    const missing = Object.assign(new Error('function legal_hold_blocks does not exist'), { code: '42883' })
    const sql = { begin: vi.fn().mockRejectedValue(missing) }

    await purgerOver(sql, createFailureStreak({ label: '[purger] queue', escalateAfter: ESCALATE_AFTER })).tick()

    expect(error.mock.calls.map(([line]) => line)).toEqual([
      '[purger] failed to reap stranded rows:',
      '[purger] failed to re-offer exhausted rows:',
      '[purger] tick failed, retrying on the next poll:',
    ])
  })
})

/**
 * A database that hands the purger one due folder entry, and records every
 * statement with the transaction it ran in.
 */
function queueWithOneFolder() {
  const statements = []
  let transactions = 0
  let claimed = false
  const begin = async (cb) => {
    transactions += 1
    const index = transactions
    const tx = (strings, ...values) => {
      const text = strings.join('$').replace(/\s+/g, ' ').trim()
      statements.push({ text, values, transaction: index })
      if (/^SELECT q\.\* FROM deletion_queue/.test(text) && !claimed) {
        claimed = true
        return Promise.resolve([{ id: 'q1', entity_type: 'folder', entity_id: 'f1', organization_id: 'org_1', display_name: 'Pläne' }])
      }
      if (/legal_hold_blocks/.test(text)) return Promise.resolve([{ held: false }])
      return Promise.resolve([])
    }
    tx.unsafe = () => Promise.resolve([])
    return cb(tx)
  }
  return { sql: { begin }, statements }
}

describe('a purge and its record are one transaction', () => {
  it('marks the row purged in the transaction the purge ran in, not in one after it', async () => {
    // As a write of its own it could fail alone after the purge committed. On
    // the last attempt the row of an erased folder then went `failed`: from
    // the catch that records a failed purge, or from the reap 15 minutes on.
    spies()
    const { sql, statements } = queueWithOneFolder()
    const deps = {
      frontendUrl: 'http://frontend:3000',
      internalToken: 't',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ counts: {}, traceConversationIds: [] }) }),
      eraseConversationTraces: async () => ({ traces: 0 }),
    }
    const purger = createPurger({
      sql,
      deps: /** @type {never} */ (deps),
      streak: createFailureStreak({ label: '[purger] queue', escalateAfter: ESCALATE_AFTER }),
    })

    await purger.processOne()

    const payload = statements.find((statement) => statement.text.includes('SET payload ='))
    const purged = statements.find((statement) => statement.text.includes("SET status = 'purged'"))
    expect(payload).toBeDefined()
    expect(purged).toBeDefined()
    expect(purged.transaction).toBe(payload.transaction)
    expect(statements.some((statement) => /SET status = (CASE|'failed')/.test(statement.text))).toBe(false)
  })

  it('re-offers exhausted pending rows on every tick, before it claims', async () => {
    spies()
    const { sql, statements } = queueWithOneFolder()
    const purger = createPurger({
      sql,
      deps: /** @type {never} */ ({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }),
      streak: createFailureStreak({ label: '[purger] queue', escalateAfter: ESCALATE_AFTER }),
    })

    await purger.tick()

    const reoffer = statements.findIndex((statement) => /SET attempts = \$ WHERE status = 'pending'/.test(statement.text))
    const claim = statements.findIndex((statement) => /^SELECT q\.\* FROM deletion_queue/.test(statement.text))
    expect(reoffer).toBeGreaterThanOrEqual(0)
    expect(reoffer).toBeLessThan(claim)
  })
})

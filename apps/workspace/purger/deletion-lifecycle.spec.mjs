/**
 * @vitest-environment node
 *
 * The deletion queue's lifecycle is declared once, in TypeScript
 * (`DELETION_LIFECYCLE`, `bff/db/schema/deletion-queue.ts`, ADR-0179). The
 * purger cannot import it: it runs as `node purger/index.js` from the frontend
 * image with no build step, and its modules are CommonJS on purpose
 * (`types.d.ts`). So its SQL spells the statuses, and this spec holds every
 * one of them, and every move its writes make, to the declaration.
 */
import { describe, expect, it } from 'vitest'
import { DELETION_LIFECYCLE, DELETION_MAX_ATTEMPTS, DELETION_STATUSES } from '../bff/db/schema/deletion-queue'
import * as queue from './db.js'

/** Run one helper over a recording client and answer the statements it sent. */
async function statementsOf(run) {
  const executed = []
  const sql = (strings) => {
    const text = strings.join('$').replace(/\s+/g, ' ').trim()
    executed.push(text)
    return Promise.resolve(/^SELECT/.test(text) ? [{ id: 'q1' }] : [])
  }
  sql.begin = (cb) => cb(sql)
  sql.unsafe = () => Promise.resolve([])
  await run(sql)
  return executed
}

/** The quoted words of a piece of SQL that sit where a status does. */
function statusesIn(sql) {
  return [...sql.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
}

/**
 * The moves one helper's statements make: from every status a WHERE matches
 * (the claim's is its SELECT's) to every status a SET writes.
 */
function movesOf(statements) {
  const from = statements.flatMap((text) => {
    const where = text.indexOf(' WHERE ')
    return where < 0 ? [] : [...text.slice(where).matchAll(/status = '([a-z_]+)'/g)].map((match) => match[1])
  })
  const to = statements.flatMap((text) => {
    const set = /SET status = (CASE .*? END|'[a-z_]+')/.exec(text)
    return set ? statusesIn(set[1]) : []
  })
  return { from: [...new Set(from)], to: [...new Set(to)] }
}

const CLAIM = { id: 'q1', claim_token: '2026-11-11 10:00:00.123456+00' }

const WRITERS = {
  claimNext: (sql) => queue.claimNext(sql),
  releaseHeld: (sql) => queue.releaseHeld(sql, CLAIM),
  markPurged: (sql) => queue.markPurged(sql, CLAIM),
  markFailed: (sql) => queue.markFailed(sql, CLAIM, 'boom'),
  markFailedPermanent: (sql) => queue.markFailedPermanent(sql, CLAIM, 'boom'),
  closeErased: (sql) => queue.closeErased(sql),
  reapStranded: (sql) => queue.reapStranded(sql),
  reofferExhausted: (sql) => queue.reofferExhausted(sql),
}

describe('the purger’s queue writes follow the declared deletion lifecycle', () => {
  it('covers every function `db.js` exports', () => {
    const exported = Object.keys(queue).filter((name) => typeof queue[name] === 'function' && name !== 'hasActiveHold')
    expect(exported.sort()).toEqual(Object.keys(WRITERS).sort())
  })

  it('gives up after as many attempts as the declaration says', () => {
    expect(queue.MAX_ATTEMPTS).toBe(DELETION_MAX_ATTEMPTS)
  })

  it.each(Object.entries(WRITERS))('%s names only declared statuses, and makes only declared moves', async (_name, run) => {
    const statements = await statementsOf(run)
    const { from, to } = movesOf(statements)

    for (const status of [...from, ...to]) expect(DELETION_STATUSES).toContain(status)
    // Every write names the states it moves a row out of: none is unguarded.
    expect(from.length).toBeGreaterThan(0)
    for (const source of from) {
      for (const target of to) {
        const declared = DELETION_LIFECYCLE.moves.some((move) => move.from === source && move.to === target)
        expect(declared, `${source} → ${target} is not a move of the deletion lifecycle`).toBe(true)
      }
    }
  })

  it('makes exactly the moves the declaration gives a holder of the claim', async () => {
    const made = new Set()
    for (const run of Object.values(WRITERS)) {
      const { from, to } = movesOf(await statementsOf(run))
      for (const source of from) for (const target of to) made.add(`${source} → ${target}`)
    }
    // `close` from `failed`: the holder of a claim the reap failed while its
    // purge still ran (`markPurged`), and a folder that is provably erased
    // (`closeErased`). The purger never closes a `pending` row; the chat's
    // delete request does.
    const declared = DELETION_LIFECYCLE.moves
      .filter((move) => ['claim', 'reclaim', 'finish', 'release', 'fail'].includes(move.event) || (move.event === 'close' && move.from === 'failed'))
      .map((move) => `${move.from} → ${move.to}`)
    expect([...made].sort()).toEqual(declared.sort())
  })
})

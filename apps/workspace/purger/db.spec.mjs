/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  claimNext,
  closeErased,
  hasActiveHold,
  markFailed,
  markFailedPermanent,
  markPurged,
  reapStranded,
  reofferExhausted,
  releaseHeld,
  MAX_ATTEMPTS,
} from './db.js'

// The db.js helpers take a postgres.js tagged-template function (`sql`/`tx`).
// We fake it the same way purge-project.spec.mjs does: record the rendered SQL
// text + bound values, and return configurable rows. `join('$')` renders each
// interpolation as a `$` placeholder; the interpolated values land, in order,
// in the `values` array — so we assert on both the SQL shape and the bindings.
function makeSql(returnRows = []) {
  const executed = []
  const fn = (strings, ...values) => {
    const text = strings.join('$').replace(/\s+/g, ' ').trim()
    executed.push({ text, values })
    // SELECT and `... RETURNING` yield rows; plain writes yield [].
    if (/^SELECT/i.test(text) || /RETURNING/i.test(text)) {
      return Promise.resolve(returnRows)
    }
    return Promise.resolve([])
  }
  // Every helper now runs inside a platform-scoped transaction (ADR-0041), so
  // the fake answers both call styles: as a tagged template for the statement
  // itself, and as a client exposing `.begin` / `.unsafe` for the step-up.
  fn.begin = (cb) => cb(fn)
  fn.unsafe = (text) => {
    executed.push({ text, values: [] })
    return Promise.resolve([])
  }
  return { fn, executed }
}

/** A claim as `claimNext` hands it to every closing write: the row, and the token the claim wrote. */
const CLAIM = { id: 'e1', claim_token: '2026-11-11 10:00:00.123456+00' }

/** Statements a helper ran, excluding the `SET LOCAL ROLE` step-up. */
function queries(executed) {
  return executed.filter((q) => !q.text.startsWith('SET LOCAL ROLE'))
}

describe('claimNext', () => {
  it('selects a due row with backoff, stale-reclaim, hold and attempt guards, then claims it', async () => {
    const { fn, executed } = makeSql([{ id: 'e1', entity_type: 'project', claim_token: CLAIM.claim_token }])

    const entry = await claimNext(fn)

    expect(entry).toEqual({ id: 'e1', entity_type: 'project', claim_token: CLAIM.claim_token })
    expect(queries(executed)).toHaveLength(2)

    const select = queries(executed)[0]
    expect(select.text).toMatch(/^SELECT q\.\* FROM deletion_queue q/)
    // pending branch has exponential backoff off claimed_at
    expect(select.text).toContain("q.status = 'pending' AND q.purge_after <= now()")
    expect(select.text).toContain('60 * power(2, least(q.attempts, 6))')
    // stale-reclaim branch for crashed purgers
    expect(select.text).toContain("q.status = 'purging' AND q.claimed_at < now()")
    // shared attempt cap + legal-hold guard + lock
    expect(select.text).toContain('q.attempts < $')
    // The hold guard is the shared database predicate, not a copy of it
    // (migration 0093): the BFF's deletes and the delete triggers call it too.
    expect(select.text).toContain(
      'AND NOT legal_hold_blocks(q.entity_type, q.entity_id, q.organization_id)',
    )
    expect(select.text).not.toContain('FROM legal_holds')
    expect(select.text).toContain('FOR UPDATE SKIP LOCKED')
    expect(select.text).toContain('ORDER BY q.requested_at')
    // bindings: STALE_CLAIM_MINUTES (15) then MAX_ATTEMPTS
    expect(select.values).toEqual([15, MAX_ATTEMPTS])

    const claim = executed[1]
    expect(claim.text).toContain(
      "SET status = 'purging', claimed_at = now(), attempts = attempts + 1",
    )
    expect(claim.values).toEqual(['e1'])
    // The token every closing write matches: the claim's own `claimed_at`, as
    // text, so its microseconds survive the driver.
    expect(claim.text).toMatch(/RETURNING claimed_at::text AS claim_token$/)
  })

  it('returns null and issues no claim UPDATE when nothing is due', async () => {
    const { fn, executed } = makeSql([])

    const entry = await claimNext(fn)

    expect(entry).toBeNull()
    expect(queries(executed)).toHaveLength(1)
    expect(queries(executed)[0].text).toMatch(/^SELECT/)
  })
})

describe('hasActiveHold', () => {
  const entry = { entity_type: 'project', entity_id: 'p1', organization_id: 'org_1' }

  it('asks the shared database predicate with the entry, nothing hand-written', async () => {
    const { fn, executed } = makeSql([{ held: true }])

    await expect(hasActiveHold(fn, entry)).resolves.toBe(true)

    expect(executed).toHaveLength(1)
    expect(executed[0].text).toBe('SELECT legal_hold_blocks($, $, $) AS held')
    expect(executed[0].values).toEqual(['project', 'p1', 'org_1'])
  })

  it('answers false when the predicate does', async () => {
    const { fn } = makeSql([{ held: false }])
    await expect(hasActiveHold(fn, entry)).resolves.toBe(false)
  })
})

describe('reapStranded', () => {
  it("terminalizes 'purging' rows past max attempts + stale window to 'failed', preserving last_error", async () => {
    const { fn, executed } = makeSql([{ id: 'a' }, { id: 'b' }])

    const reaped = await reapStranded(fn)

    expect(reaped).toBe(2)
    expect(queries(executed)).toHaveLength(1)
    const q = queries(executed)[0]
    expect(q.text).toMatch(/^UPDATE deletion_queue/)
    expect(q.text).toContain("SET status = 'failed'")
    expect(q.text).toContain('COALESCE( last_error,')
    expect(q.text).toContain("WHERE status = 'purging'")
    expect(q.text).toContain('attempts >= $')
    expect(q.text).toContain('claimed_at < now() - make_interval(mins => $)')
    expect(q.text).toContain('RETURNING id')
    // does NOT re-attempt the purge — no SELECT/claim, pure state transition
    expect(q.values).toEqual([MAX_ATTEMPTS, 15])
  })

  it('reports zero when no rows are stranded', async () => {
    const { fn } = makeSql([])
    expect(await reapStranded(fn)).toBe(0)
  })
})

describe('releaseHeld', () => {
  it("returns the row to 'pending' and refunds one attempt (never below 0)", async () => {
    const { fn, executed } = makeSql()

    await releaseHeld(fn, { ...CLAIM, id: 'e9' })

    const q = queries(executed)[0]
    expect(q.text).toContain("SET status = 'pending'")
    expect(q.text).toContain('attempts = GREATEST(attempts - 1, 0)')
    expect(q.text).toContain('last_error =')
    expect(q.values).toEqual(['e9', CLAIM.claim_token])
  })
})

describe('reofferExhausted', () => {
  it("gives a 'pending' row with no attempts left its last one back, so the claim takes it again", async () => {
    // claimNext asks `attempts < MAX_ATTEMPTS`: a pending row at the cap reads
    // as waiting and is never purged.
    const { fn, executed } = makeSql([{ id: 'a' }])

    expect(await reofferExhausted(fn)).toBe(1)

    const q = queries(executed)[0]
    expect(q.text).toMatch(/^UPDATE deletion_queue SET attempts = \$ WHERE status = 'pending' AND attempts >= \$ RETURNING id$/)
    expect(q.values).toEqual([MAX_ATTEMPTS - 1, MAX_ATTEMPTS])
  })
})

describe('a late answer never moves a row that is no longer claimed', () => {
  // Two holders can run one purge: the purger takes over a claim 15 minutes
  // old, and „Endgültig löschen" claims in a request. Whoever answers second
  // must not pull a `purged` row back to `pending` or `failed`.
  it.each([
    ['releaseHeld', (sql) => releaseHeld(sql, CLAIM)],
    ['markFailed', (sql) => markFailed(sql, CLAIM, 'boom')],
    ['markFailedPermanent', (sql) => markFailedPermanent(sql, CLAIM, 'boom')],
  ])('%s writes only a row still purging, and only under the claim it took', async (_name, run) => {
    const { fn, executed } = makeSql()
    await run(fn)
    const q = queries(executed)[0]
    // A claim taken over carries another `claimed_at`: the status alone could
    // not tell this holder's `purging` from the next one's.
    expect(q.text).toMatch(/WHERE id = \$ AND status = 'purging' AND claimed_at = \$::text::timestamptz$/)
    expect(q.values.slice(-2)).toEqual([CLAIM.id, CLAIM.claim_token])
  })

  it('markPurged closes only the row under its own claim, also one the reap failed while the purge still ran', async () => {
    const { fn, executed } = makeSql()
    await markPurged(fn, CLAIM)
    const q = queries(executed)[0]
    expect(q.text).toMatch(
      /WHERE id = \$ AND \(status = 'purging' OR status = 'failed'\) AND claimed_at = \$::text::timestamptz$/,
    )
    expect(q.values).toEqual([CLAIM.id, CLAIM.claim_token])
  })
})

describe('closeErased', () => {
  it('closes as purged only a folder row whose folder is purged and whose removal owes no traces', async () => {
    const { fn, executed } = makeSql([{ id: 'e1' }, { id: 'e2' }])

    expect(await closeErased(fn)).toBe(2)

    const q = queries(executed)[0]
    expect(q.text).toContain("SET status = 'purged', purged_at = now(), last_error = NULL")
    expect(q.text).toContain("q.entity_type = 'folder'")
    // A row recorded as failed, or one the reap is about to fail; never a live claim.
    expect(q.text).toContain("q.status = 'failed' OR ( q.status = 'purging' AND q.attempts >= $ AND q.claimed_at < now() - make_interval(mins => $) )")
    expect(q.text).toContain("(q.payload #> '{derivedRemoval,conversationIds,0}') IS NULL")
    expect(q.text).toContain('f.purged_at IS NOT NULL')
    expect(q.values).toEqual([MAX_ATTEMPTS, 15])
  })
})

describe('markPurged', () => {
  it("marks 'purged', stamps purged_at, clears last_error", async () => {
    const { fn, executed } = makeSql()

    await markPurged(fn, CLAIM)

    const q = queries(executed)[0]
    expect(q.text).toContain("SET status = 'purged', purged_at = now(), last_error = NULL")
    expect(q.values).toEqual([CLAIM.id, CLAIM.claim_token])
  })

  it('runs in the transaction it is given, the purge’s, and opens none of its own', async () => {
    // A write of its own after the purge committed could fail alone, and the
    // row of an erased entity then read `failed` once its attempts were spent.
    const { fn, executed } = makeSql()
    fn.begin = () => {
      throw new Error('markPurged opened a transaction of its own')
    }

    await markPurged(fn, CLAIM)

    expect(executed).toHaveLength(1)
  })
})

describe('markFailed', () => {
  it("only reaches terminal 'failed' at MAX_ATTEMPTS, otherwise returns to 'pending' for retry", async () => {
    const { fn, executed } = makeSql()

    await markFailed(fn, CLAIM, 'boom')

    const q = queries(executed)[0]
    expect(q.text).toContain(
      "SET status = CASE WHEN attempts >= $ THEN 'failed' ELSE 'pending' END",
    )
    // bindings: MAX_ATTEMPTS, message, id, the claim's token
    expect(q.values).toEqual([MAX_ATTEMPTS, 'boom', CLAIM.id, CLAIM.claim_token])
  })

  it('truncates an oversized error message to 2000 chars', async () => {
    const { fn, executed } = makeSql()

    await markFailed(fn, CLAIM, 'x'.repeat(5000))

    expect(queries(executed)[0].values[1]).toHaveLength(2000)
  })
})

describe('markFailedPermanent', () => {
  it("marks 'failed' unconditionally (no attempt-count CASE)", async () => {
    const { fn, executed } = makeSql()

    await markFailedPermanent(fn, CLAIM, 'no purger registered')

    const q = queries(executed)[0]
    expect(q.text).toContain("SET status = 'failed'")
    expect(q.text).not.toContain('CASE')
    expect(q.values).toEqual(['no purger registered', CLAIM.id, CLAIM.claim_token])
  })
})

/**
 * Losing the step-up would not fail loudly: row-level security would hide every
 * organization's rows, the queue would look permanently empty, and the purger
 * would report healthy ticks while deleting nothing (ADR-0041).
 */
describe('platform scope', () => {
  it('steps up to the BYPASSRLS role before every statement', async () => {
    for (const run of [
      (sql) => releaseHeld(sql, CLAIM),
      (sql) => markFailed(sql, CLAIM, 'boom'),
      (sql) => markFailedPermanent(sql, CLAIM, 'boom'),
      (sql) => closeErased(sql),
      (sql) => reapStranded(sql),
      (sql) => reofferExhausted(sql),
    ]) {
      const { fn, executed } = makeSql()
      await run(fn)
      expect(executed[0].text).toBe('SET LOCAL ROLE app_platform')
      expect(executed).toHaveLength(2)
    }
  })
})

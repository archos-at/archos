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
    ]) {
      const { fn, executed } = makeSql()
      await run(fn)
      expect(executed[0].text).toBe('SET LOCAL ROLE app_platform')
      expect(executed).toHaveLength(2)
    }
  })
})

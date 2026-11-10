// @disk-inputs: ../../configs/knowledge-packs/at.json, ../../configs/knowledge-packs/eu.json
/**
 * @vitest-environment node
 *
 * The `knowledge` phase's compute stays well inside its budget (design §5.5:
 * p95 ≤ 40 ms warm, ≤ 150 ms cold): the resolver over the real Austria and EU
 * packs, every Land, timed. The database reads are measured where they run,
 * on the turn's `Server-Timing` (`knowledge`, `knowledge-graph`), and the
 * cache keeps a warm turn off them; this holds the part a slower resolver
 * would add to every miss, at a quarter of the warm budget.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { graphFromProposals } from '../chain/from-proposals'
import { proposedRecordSchema } from '../platform/wire'
import { resolveKnowledgeContext } from './resolve'

const read = (name: string) =>
  proposedRecordSchema
    .array()
    .parse(JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', name), 'utf8')).records)

const GRAPH = graphFromProposals([...read('eu.json'), ...read('at.json')])
const LANDS = ['AT-1', 'AT-2', 'AT-3', 'AT-4', 'AT-5', 'AT-6', 'AT-7', 'AT-8', 'AT-9']

/** A quarter of the warm budget: the resolver must leave the reads the rest. */
const RESOLVER_P95_MS = 10

describe('the knowledge phase budget', () => {
  it('resolves every Land of the Austria pack at p95 within a quarter of the warm budget', () => {
    const timings: number[] = []
    for (let round = 0; round < 20; round += 1) {
      for (const land of LANDS) {
        const started = performance.now()
        const context = resolveKnowledgeContext({
          homeCountry: 'AT',
          entitled: new Set(['AT']),
          sites: [{ territoryId: land, certainty: 'verified' }],
          graph: GRAPH,
          truncated: false,
          date: '2026-12-14',
          now: new Date('2026-12-14T12:00:00Z'),
          procedures: [],
          packSeqs: { AT: 1, EU: 1 },
        })
        timings.push(performance.now() - started)
        expect(context.gate.state).toBe('core')
        expect(context.uses.length).toBeGreaterThan(0)
      }
    }
    const sorted = timings.sort((a, b) => a - b)
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    expect(p95).toBeLessThan(RESOLVER_P95_MS)
  })
})

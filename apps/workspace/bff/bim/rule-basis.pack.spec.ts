// @disk-inputs: ../../configs/knowledge-packs/at.json, ../../configs/knowledge-packs/eu.json
/**
 * @vitest-environment node
 *
 * The rule catalogue against the records it cites (country-as-data §7 row 9):
 * every rule names an edition the pack holds, and over the Austria pack each
 * Land gives a verdict where the rule's edition binds there and a hint where
 * another does, at a fixed date. The labels are the interim key until rules
 * carry edition ids.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { graphFromProposals } from '@/lib/base-knowledge/chain/from-proposals'
import { resolveKnowledgeContext } from '@/lib/base-knowledge/context/resolve'
import { proposedRecordSchema } from '@/lib/base-knowledge/platform/wire'
import { ruleBasis } from './rule-basis'
import { BIM_RULES } from './rules'

const read = (name: string) =>
  proposedRecordSchema
    .array()
    .parse(JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', name), 'utf8')).records)

const AT = read('at.json')
const GRAPH = graphFromProposals([...read('eu.json'), ...AT])
const LANDS = ['AT-1', 'AT-2', 'AT-3', 'AT-4', 'AT-5', 'AT-6', 'AT-7', 'AT-8', 'AT-9'] as const

/** V: verdict, H: hint; per rule, Länder AT-1 to AT-9, on 2026-11-11. */
const EXPECTED: Record<string, string> = {
  'oib4-stair-rise-run-ratio': 'H V V V V H V H V',
  'oib4-door-clear-width': 'H V V V V H V H V',
  'oib3-room-height': 'H V V V V H V H V',
  'oib2-fire-resistance-load-bearing': 'H V V V V H V H V',
  'oib6-u-value-external-wall': 'H V V H H H H H H',
  'oib6-u-value-window': 'H V V H H H H H H',
  'oib5-sound-insulation-declared': 'H V V V V H V H V',
}

describe('the rule catalogue against the Austria pack', () => {
  it('names, for every rule, an edition the pack holds (the step-9 gate)', () => {
    const works = new Map(AT.flatMap((record) => (record.type === 'work' ? [[record.designation, record.key] as const] : [])))
    const editions = new Set(AT.flatMap((record) => (record.type === 'edition' ? [`${record.workKey}|${record.label}`] : [])))
    for (const rule of BIM_RULES) {
      expect(editions, `${rule.id}: ${rule.designation}, ${rule.edition}`).toContain(`${works.get(rule.designation)}|${rule.edition}`)
    }
  })

  it('gives a verdict where the edition binds in the Land and a hint where another does', () => {
    const matrix = Object.fromEntries(
      BIM_RULES.map((rule) => [
        rule.id,
        LANDS.map((land) => {
          const context = resolveKnowledgeContext({
            homeCountry: 'AT',
            entitled: new Set(['AT']),
            sites: [{ territoryId: land, certainty: 'verified' }],
            graph: GRAPH,
            truncated: false,
            date: '2026-11-11',
            now: new Date('2026-11-11T12:00:00Z'),
            procedures: [],
            packSeqs: { AT: 1, EU: 1 },
          })
          return ruleBasis(rule, context).kind === 'verdict' ? 'V' : 'H'
        }).join(' '),
      ]),
    )
    expect(matrix).toEqual(EXPECTED)
  })
})

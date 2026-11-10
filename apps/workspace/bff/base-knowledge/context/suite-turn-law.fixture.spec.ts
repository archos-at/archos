// @disk-inputs: ../../configs/knowledge-packs/at.json, ../../configs/knowledge-packs/eu.json, ../../tests/fixtures/base-knowledge/turn_law_austria.json
/**
 * @vitest-environment node
 *
 * What the answer suite's turns read about the law of their site
 * (`scripts/turn_census/fixture_law.py`, ADR-0175): for each Land, the
 * knowledge context (its gate, chain text and edition roles) an entitled
 * Austrian office's turn carries once the Austria and EU packs are published. Written by the
 * production resolvers from the packs themselves, so the suite measures what
 * a turn reads in production and cannot drift from it. Since ADR-0175 a turn
 * without a context reads no law at all, so a suite without this file would
 * measure that instead.
 *
 * `UPDATE_FIXTURES=1` rewrites the file; commit it with the pack change that moved it.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { proposeRecordsBodySchema } from '../platform/wire'
import { graphFromProposals } from '../chain/from-proposals'
import { buildingLawTurn } from '../chain/wire'
import { resolveKnowledgeContext } from './resolve'
import { knowledgeContextSchema } from './wire'

const ROOT = join(process.cwd(), '..', '..')
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'base-knowledge', 'turn_law_austria.json')
/** The day the fixture resolves on: fixed, so a regeneration moves only with the packs. */
const DATE = '2026-11-10'
const LANDS: Record<string, string> = {
  'AT-1': 'Burgenland',
  'AT-2': 'Kärnten',
  'AT-3': 'Niederösterreich',
  'AT-4': 'Oberösterreich',
  'AT-5': 'Salzburg',
  'AT-6': 'Steiermark',
  'AT-7': 'Tirol',
  'AT-8': 'Vorarlberg',
  'AT-9': 'Wien',
}

const pack = (name: string) =>
  proposeRecordsBodySchema.parse({
    records: (JSON.parse(readFileSync(join(ROOT, 'configs', 'knowledge-packs', name), 'utf8')) as { records: unknown[] }).records,
  }).records
const graph = graphFromProposals([...pack('eu.json'), ...pack('at.json')])

function turnLaw(territoryId: string, place: string) {
  const knowledgeContext = knowledgeContextSchema.parse(
    resolveKnowledgeContext({
      homeCountry: 'AT',
      entitled: new Set(['AT']),
      sites: [{ territoryId, certainty: 'verified' }],
      graph,
      truncated: false,
      date: DATE,
      now: new Date(`${DATE}T12:00:00Z`),
      procedures: [],
      packSeqs: { AT: 1, EU: 1 },
    }),
  )
  // The agent reads which law applies from `knowledgeContext` alone (its chain text and roles). Until the
  // context resolver writes the chain text itself (#1584), it is the chain resolver's, as the BFF renders it.
  const chain = buildingLawTurn(graph, territoryId, DATE, place)
  return { knowledgeContext: { ...knowledgeContext, text: chain?.text ?? null } }
}

describe("the answer suite's Austrian turn law", () => {
  const generated = `${JSON.stringify(Object.fromEntries(Object.entries(LANDS).map(([id, place]) => [id, turnLaw(id, place)])), null, 2)}\n`

  it('reads core coverage and a chain in every Land', () => {
    for (const [id, law] of Object.entries(JSON.parse(generated) as Record<string, ReturnType<typeof turnLaw>>)) {
      expect(law.knowledgeContext.gate.state, id).toBe('core')
      expect(law.knowledgeContext.retrieval.countries, id).toContain('AT')
      expect(law.knowledgeContext.text, id).toContain('Building law at this site')
    }
  })

  it('is the committed fixture', () => {
    if (process.env.UPDATE_FIXTURES === '1') writeFileSync(FIXTURE, generated, 'utf8')
    expect(
      readFileSync(FIXTURE, 'utf8'),
      'The packs or the resolvers changed. Re-run with UPDATE_FIXTURES=1 and commit the fixture in the same change.',
    ).toBe(generated)
  })
})

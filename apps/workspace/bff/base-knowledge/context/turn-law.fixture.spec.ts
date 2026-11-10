// @disk-inputs: ../../configs/knowledge-packs/at.json, ../../configs/knowledge-packs/eu.json, ../../tests/fixtures/base-knowledge/turn_law_austria.json, tests/fixtures/knowledge-context.schema.json
/**
 * @vitest-environment node
 *
 * The knowledge context's contract with the Python tier (ADR-0175): one
 * payload for the law of a site, so one schema, generated from the zod source
 * (`knowledge-context.schema.json`), and one fixture per Austrian Land written
 * by the production resolver from the packs themselves
 * (`tests/fixtures/base-knowledge/turn_law_austria.json`): what an entitled
 * Austrian office's turn carries once the Austria and EU packs are published.
 * The agent's parity test validates the fixture against the schema and parses
 * it without losing a use; the answer suite reads the same file
 * (`scripts/turn_census/fixture_law.py`).
 *
 * `UPDATE_FIXTURES=1` rewrites both; commit them with the change that moved them.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { jsonSchemaDocument } from '@/lib/api/zod-json-schema'
import { graphFromProposals } from '../chain/from-proposals'
import { MAX_PROPOSED_RECORDS, proposeRecordsBodySchema } from '../platform/wire'
import { resolveKnowledgeContext } from './resolve'
import { knowledgeContextSchema } from './wire'

const ROOT = join(process.cwd(), '..', '..')
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'base-knowledge', 'turn_law_austria.json')
const SCHEMA = join(process.cwd(), 'tests', 'fixtures', 'knowledge-context.schema.json')
/** The day the fixture resolves on: fixed, so a regeneration moves only with the packs. */
const DATE = '2026-11-10'
const LANDS = ['AT-1', 'AT-2', 'AT-3', 'AT-4', 'AT-5', 'AT-6', 'AT-7', 'AT-8', 'AT-9'] as const

/** A pack's records, parsed in batches as records-propose takes them: a pack may hold more than one batch carries. */
const pack = (name: string) => {
  const raw = (JSON.parse(readFileSync(join(ROOT, 'configs', 'knowledge-packs', name), 'utf8')) as { records: unknown[] }).records
  const batches: unknown[][] = []
  for (let start = 0; start < raw.length; start += MAX_PROPOSED_RECORDS) batches.push(raw.slice(start, start + MAX_PROPOSED_RECORDS))
  return batches.flatMap((records) => proposeRecordsBodySchema.parse({ records }).records)
}
const graph = graphFromProposals([...pack('eu.json'), ...pack('at.json')])

const contextAt = (territoryId: string) =>
  knowledgeContextSchema.parse(
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

const generated = `${JSON.stringify(Object.fromEntries(LANDS.map((id) => [id, { knowledgeContext: contextAt(id) }])), null, 2)}\n`
const schema = `${JSON.stringify(
  jsonSchemaDocument(
    { KnowledgeContext: knowledgeContextSchema },
    {
      title: 'The knowledge context a turn carries',
      description:
        'Generated from apps/workspace/bff/base-knowledge/context/wire.ts. Do not edit by hand: ' +
        'turn-law.fixture.spec.ts rewrites this file and fails when it is stale.',
    },
  ),
  null,
  2,
)}\n`

const committed = (path: string, text: string) => {
  if (process.env.UPDATE_FIXTURES === '1') writeFileSync(path, text, 'utf8')
  return readFileSync(path, 'utf8')
}

describe('the knowledge context’s contract with the Python tier', () => {
  it('reads core coverage, a chain text and named uses in every Land', () => {
    for (const [id, { knowledgeContext }] of Object.entries(JSON.parse(generated) as Record<string, { knowledgeContext: ReturnType<typeof contextAt> }>)) {
      expect(knowledgeContext.gate.state, id).toBe('core')
      expect(knowledgeContext.text, id).toContain('Building law at this site')
      expect(knowledgeContext.uses.every((use) => 'designation' in use && 'sourceRefs' in use), id).toBe(true)
    }
  })

  it('names the Bauordnung für Wien by its identifiers at RIS, so a passage read live there finds it', () => {
    const vienna = (JSON.parse(generated) as Record<string, { knowledgeContext: ReturnType<typeof contextAt> }>)['AT-9'].knowledgeContext
    expect(vienna.uses.find((use) => use.workId === 'work:bo-wien')?.sourceRefs).toEqual([
      { scheme: 'eli', value: 'https://www.ris.bka.gv.at/eli/lgbl/WI/1930/11' },
      { scheme: 'ris_dokumentnummer', value: 'LWI40000225' },
      { scheme: 'ris_gesetzesnummer', value: '20000006' },
    ])
  })

  it('is the committed fixture', () => {
    expect(committed(FIXTURE, generated), 'The packs or the resolver changed. Re-run with UPDATE_FIXTURES=1 and commit the fixture.').toBe(generated)
  })

  it('is the committed schema', () => {
    expect(committed(SCHEMA, schema), 'The context wire changed. Re-run with UPDATE_FIXTURES=1 and commit the schema.').toBe(schema)
  })
})

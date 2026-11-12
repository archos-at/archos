/**
 * @vitest-environment node
 *
 * A large country answers (country-as-data §3.4, step 5): no count withholds
 * the law of a site. The synthetic country `XS` is shaped like a German one:
 * Land XS-1's building code makes its administrative regulation binding (the
 * VV TB), which lists 400 technical standards, each in the edition it replaced
 * too; Länder XS-2 to XS-9 list most of the same standards through their own,
 * about 2,600 relations more. XS-1 resolves at gate `core` with every listed
 * standard binding, the chain text counts what it does not name, and the
 * resolution stays inside the knowledge phase's budget.
 */

import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { graphFromProposals } from '../chain/from-proposals'
import { resolveChain } from '../chain/resolve'
import { MAX_SECTION_LINES } from '../chain/text'
import { proposedRecordSchema } from '../platform/wire'
import { resolveKnowledgeContext } from './resolve'
import { knowledgeContextSchema, MAX_CONTEXT_USES } from './wire'

const STANDARDS = 400
const LISTED_ELSEWHERE = 325
const LANDS = Array.from({ length: 9 }, (_, index) => `XS-${index + 1}`)
/** A record key of a Land's own instrument: keys are lower case. */
const keyOf = (land: string) => land.toLowerCase()

const relation = (key: string, from: string, to: string) => ({
  type: 'relation',
  key,
  relationType: 'makes_binding',
  mode: 'dynamic_reference',
  from: { type: 'work', key: from },
  to: { type: 'work', key: to },
})

function records(): unknown[] {
  const out: unknown[] = [{ type: 'territory', id: 'XS', kind: 'country', name: 'Synthetic', coverageLevel: 'core' }]
  for (const land of LANDS) {
    const key = keyOf(land)
    out.push(
      { type: 'territory', id: land, kind: 'state', name: land, parents: [{ id: 'XS' }] },
      { type: 'work', key: `code-${key}`, kind: 'statute', title: `Building code ${land}`, territoryIds: [land] },
      { type: 'edition', key: `code-${key}-2020`, workKey: `code-${key}`, label: '2020', issuedOn: '2020-01-01', inForceFrom: '2020-01-01' },
      { type: 'work', key: `vvtb-${key}`, kind: 'administrative_regulation', title: `VV TB ${land}`, territoryIds: [land] },
      { type: 'edition', key: `vvtb-${key}-2024`, workKey: `vvtb-${key}`, label: '2024', issuedOn: '2024-01-01' },
      relation(`code-vvtb-${key}`, `code-${key}`, `vvtb-${key}`),
    )
  }
  for (let index = 0; index < STANDARDS; index++) {
    out.push(
      { type: 'work', key: `std-${index}`, kind: 'technical_standard', title: `Standard ${String(index).padStart(3, '0')}` },
      { type: 'edition', key: `std-${index}-2015`, workKey: `std-${index}`, label: '2015', issuedOn: '2015-01-01' },
      { type: 'edition', key: `std-${index}-2021`, workKey: `std-${index}`, label: '2021', issuedOn: '2021-01-01' },
      relation(`lists-xs-1-${index}`, 'vvtb-xs-1', `std-${index}`),
    )
    if (index >= LISTED_ELSEWHERE) continue
    for (const land of LANDS.slice(1)) out.push(relation(`lists-${keyOf(land)}-${index}`, `vvtb-${keyOf(land)}`, `std-${index}`))
  }
  return out
}

const GRAPH = graphFromProposals(records().map((record) => proposedRecordSchema.parse(record)))

const contextAt = (territoryId: string) =>
  resolveKnowledgeContext({
    homeCountry: 'XS',
    entitled: new Set(['XS']),
    sites: [{ territoryId, certainty: 'verified' }],
    graph: GRAPH,
    truncated: false,
    date: '2026-12-14',
    now: new Date('2026-12-14T12:00:00Z'),
    procedures: [],
    packSeqs: { XS: 1 },
  })

/** The warm budget of the knowledge phase (design §5.5: p95 ≤ 40 ms): a site this large may take all of it, not more. */
const RESOLVER_BEST_MS = 40

describe('a country with hundreds of listed standards', () => {
  it('holds about 3,000 relations, as the step-5 gate asks', () => {
    expect(GRAPH.relations.length).toBeGreaterThanOrEqual(3000)
  })

  it('answers at gate core with every standard the VV TB lists binding through it', () => {
    const resolved = resolveChain(GRAPH, 'XS-1', '2026-12-14')
    const listed = resolved.uses.filter((use) => use.role === 'binding' && use.route.at(-1)?.workId === 'work:vvtb-xs-1')
    expect(listed).toHaveLength(STANDARDS)
    const context = contextAt('XS-1')
    expect(context.gate.state).toBe('core')
    expect(context.uses.filter((use) => use.role === 'binding').length).toBeGreaterThanOrEqual(STANDARDS)
  })

  it('carries the first MAX_CONTEXT_USES uses on the wire, binding first, and the wire parses', () => {
    const context = knowledgeContextSchema.parse(contextAt('XS-1'))
    const binding = resolveChain(GRAPH, 'XS-1', '2026-12-14').uses.filter((use) => use.role === 'binding').length
    expect(context.uses).toHaveLength(MAX_CONTEXT_USES)
    expect(context.uses.slice(0, binding).every((use) => use.role === 'binding')).toBe(true)
    expect(context.uses.slice(binding).every((use) => use.role === 'information')).toBe(true)
  })

  it('words every use in the chain text, and counts the ones past a section truthfully', () => {
    const resolved = resolveChain(GRAPH, 'XS-1', '2026-12-14')
    const binding = resolved.uses.filter((use) => use.role === 'binding').length
    const text = contextAt('XS-1').text ?? ''
    expect(text).toContain(`\n- and ${binding - MAX_SECTION_LINES} more\n`)
    expect(text).toContain(`${STANDARDS} other editions are not in force here and are information only.`)
  })

  it('reads nothing of XS-2 at XS-1: its listing binds there only', () => {
    const own = (land: string) => contextAt(land).uses.filter((use) => use.workId === `work:vvtb-${keyOf(land)}`)
    expect(own('XS-2').map((use) => use.role)).toEqual(['binding'])
    expect(contextAt('XS-1').uses.some((use) => use.workId === 'work:vvtb-xs-2')).toBe(false)
  })

  it('resolves the site within the warm budget of the knowledge phase', () => {
    const best = Math.min(
      ...Array.from({ length: 5 }, () => {
        const started = performance.now()
        contextAt('XS-1')
        return performance.now() - started
      }),
    )
    expect(best).toBeLessThan(RESOLVER_BEST_MS)
  })

  it('cuts the wire on the final roles: a use demoted for its connecting factor never pushes out one that binds', () => {
    // MAX_CONTEXT_USES standards the VV TB lists that attach by the client only (contextUse informs, E40), and one
    // that attaches by the site, listed last: the resolver orders all of them binding, the context does not.
    const many = MAX_CONTEXT_USES
    const set: unknown[] = [
      { type: 'territory', id: 'XS', kind: 'country', name: 'Synthetic', coverageLevel: 'core' },
      { type: 'territory', id: 'XS-1', kind: 'state', name: 'XS-1', parents: [{ id: 'XS' }] },
      { type: 'work', key: 'vvtb-xs-1', kind: 'administrative_regulation', title: 'VV TB XS-1', territoryIds: ['XS-1'] },
      { type: 'edition', key: 'vvtb-xs-1-2024', workKey: 'vvtb-xs-1', label: '2024', issuedOn: '2024-01-01' },
      { type: 'work', key: 'code-xs-1', kind: 'statute', title: 'Building code XS-1', territoryIds: ['XS-1'] },
      { type: 'edition', key: 'code-xs-1-2020', workKey: 'code-xs-1', label: '2020', issuedOn: '2020-01-01', inForceFrom: '2020-01-01' },
      relation('code-vvtb-xs-1', 'code-xs-1', 'vvtb-xs-1'),
    ]
    for (let index = 0; index < many; index++) {
      set.push(
        { type: 'work', key: `client-${index}`, kind: 'technical_standard', title: `Client ${index}`, connectsBy: ['client'] },
        { type: 'edition', key: `client-${index}-2021`, workKey: `client-${index}`, label: '2021', issuedOn: '2021-01-01' },
        relation(`lists-client-${index}`, 'vvtb-xs-1', `client-${index}`),
      )
    }
    set.push(
      { type: 'work', key: 'zz-site', kind: 'technical_standard', title: 'Site standard' },
      { type: 'edition', key: 'zz-site-2021', workKey: 'zz-site', label: '2021', issuedOn: '2021-01-01' },
      relation('lists-zz-site', 'vvtb-xs-1', 'zz-site'),
    )
    const graph = graphFromProposals(set.map((record) => proposedRecordSchema.parse(record)))
    const context = resolveKnowledgeContext({
      homeCountry: 'XS',
      entitled: new Set(['XS']),
      sites: [{ territoryId: 'XS-1', certainty: 'verified' }],
      graph,
      truncated: false,
      date: '2026-12-14',
      now: new Date('2026-12-14T12:00:00Z'),
      procedures: [],
      packSeqs: { XS: 1 },
    })
    expect(context.uses).toHaveLength(MAX_CONTEXT_USES)
    expect(context.uses.find((use) => use.workId === 'work:zz-site')?.role).toBe('binding')
  })
})

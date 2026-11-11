/**
 * @vitest-environment node
 *
 * The route and the day a use's role holds from (`resolve.ts` `routeOf`,
 * `roleSinceOf`): what a citation's status line reads ("verbindlich über die
 * <Verordnung>, seit <Tag>"). A paper graph of an invented country, so nothing
 * here depends on one country's records.
 */

import { describe, expect, it } from 'vitest'
import { graphFromProposals } from '../chain/from-proposals'
import { proposeRecordsBodySchema } from '../platform/wire'
import { resolveKnowledgeContext } from './resolve'
import { knowledgeContextSchema } from './wire'

const graph = graphFromProposals(
  proposeRecordsBodySchema.parse({
    records: [
      { type: 'territory', id: 'XA', kind: 'country', name: 'Xanadu', coverageLevel: 'core' },
      { type: 'territory', id: 'XA-1', kind: 'state', name: 'Nordland', parents: [{ id: 'XA' }] },
      { type: 'work', key: 'building-act', kind: 'statute', title: 'Building Act of Nordland', designation: 'BA-N', territoryIds: ['XA-1'] },
      { type: 'edition', key: 'building-act-2020', workKey: 'building-act', label: 'as amended 2020', inForceFrom: '2020-03-01' },
      { type: 'work', key: 'technical-ordinance', kind: 'ordinance', title: 'Technical Ordinance of Nordland', designation: 'TO-N', territoryIds: ['XA-1'] },
      { type: 'edition', key: 'technical-ordinance-2022', workKey: 'technical-ordinance', label: 'TO-N 2022', inForceFrom: '2022-01-01' },
      { type: 'work', key: 'guideline-2', kind: 'guideline', title: 'Guideline 2: Fire safety', designation: 'GL 2' },
      { type: 'edition', key: 'guideline-2-2021', workKey: 'guideline-2', label: 'Edition May 2021', inForceFrom: '2021-05-01' },
      { type: 'edition', key: 'guideline-2-2025', workKey: 'guideline-2', label: 'Edition May 2025', inForceFrom: '2025-05-01' },
      {
        type: 'relation',
        key: 'to-n-binds-gl-2',
        relationType: 'makes_binding',
        mode: 'static_reference',
        from: { type: 'work', key: 'technical-ordinance' },
        to: { type: 'edition', key: 'guideline-2-2021' },
        provision: '§ 1 TO-N',
        validFrom: '2022-06-15',
      },
    ],
  }).records,
)

const uses = () =>
  knowledgeContextSchema.parse(
    resolveKnowledgeContext({
      homeCountry: 'XA',
      entitled: new Set(['XA']),
      sites: [{ territoryId: 'XA-1', certainty: 'verified' }],
      graph,
      truncated: false,
      date: '2026-11-10',
      now: new Date('2026-11-10T12:00:00Z'),
      procedures: [],
      packSeqs: { XA: 1 },
    }),
  ).uses

describe('the route and the day a role holds from', () => {
  it('names the declaring instrument, its edition and its provision for an edition a relation makes binding', () => {
    const bound = uses().find((use) => use.editionId?.endsWith('guideline-2-2021'))
    expect(bound).toMatchObject({
      role: 'binding',
      via: 'relation',
      route: { designation: 'TO-N', editionLabel: 'TO-N 2022', provision: '§ 1 TO-N' },
      // The later of the edition's entry into force (2021-05-01) and the relation's (2022-06-15).
      roleSince: '2022-06-15',
    })
  })

  it('gives law in its territory no declaring instrument, and its own entry into force', () => {
    const law = uses().find((use) => use.editionId?.endsWith('building-act-2020'))
    expect(law).toMatchObject({ role: 'binding', via: 'territory', route: null, roleSince: '2020-03-01' })
  })

  it('dates nothing that does not bind', () => {
    const others = uses().filter((use) => use.role !== 'binding')
    expect(others.length).toBeGreaterThan(0)
    for (const use of others) expect(use).toMatchObject({ route: null, roleSince: null })
  })
})

/**
 * @vitest-environment node
 *
 * The turn's building law fails closed: a truncated resolution, or a site where
 * no law of the records binds, carries no chain at all (ADR-0168).
 */

import { describe, expect, it } from 'vitest'
import { proposedRecordSchema } from '../platform/wire'
import { graphFromProposals } from './from-proposals'
import { MAX_USES } from './resolve'
import { buildingLawTurn } from './wire'

const DATE = '2026-11-10'

const territories = [
  { type: 'territory', id: 'AT', kind: 'country', name: 'Österreich' },
  { type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parentIds: ['AT'] },
]
const law = [
  { type: 'work', key: 'bo-wien', kind: 'statute', title: 'Bauordnung für Wien', territoryIds: ['AT-9'] },
  { type: 'edition', key: 'bo-wien-2024', workKey: 'bo-wien', label: 'Fassung 2024', issuedOn: '2024-01-01', inForceFrom: '2024-01-01' },
]
/** `count` model codes, each of whose newest edition guides here: one use apiece. */
const modelCodes = (count: number) =>
  Array.from({ length: count }, (_, index) => [
    { type: 'work', key: `code-${index}`, kind: 'model_code', title: `Code ${index}`, territoryIds: ['AT'] },
    { type: 'edition', key: `code-${index}-2023`, workKey: `code-${index}`, label: 'Ausgabe 2023', issuedOn: '2023-05-25' },
  ]).flat()

const graphOf = (records: readonly unknown[]) => graphFromProposals(records.map((record) => proposedRecordSchema.parse(record)))

describe('buildingLawTurn', () => {
  it('carries the chain where law of the records binds (positive control)', () => {
    const turn = buildingLawTurn(graphOf([...territories, ...law, ...modelCodes(2)]), 'AT-9', DATE, 'Wien')
    expect(turn?.chain).toEqual(['AT-9', 'AT'])
    expect(turn?.uses.map((use) => use.role)).toContain('binding')
  })

  it('carries nothing once the resolution is truncated', () => {
    const records = [...territories, ...law, ...modelCodes(MAX_USES)]
    expect(buildingLawTurn(graphOf([...territories, ...law, ...modelCodes(MAX_USES - 2)]), 'AT-9', DATE, 'Wien')).not.toBeNull()
    expect(buildingLawTurn(graphOf(records), 'AT-9', DATE, 'Wien')).toBeNull()
  })

  it('carries nothing where no law of its territory binds, only guidance', () => {
    expect(buildingLawTurn(graphOf([...territories, ...modelCodes(2)]), 'AT-9', DATE, 'Wien')).toBeNull()
  })
})

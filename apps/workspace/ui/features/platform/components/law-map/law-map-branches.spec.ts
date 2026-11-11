import { describe, expect, it } from 'vitest'
import { lawMapOf } from '@/lib/base-knowledge/platform/law-map'
import { reviewUnitsOf } from '@/lib/base-knowledge/platform/law-map-review'
import type { RevisionView } from '@/lib/base-knowledge/platform/wire'
import { branchesOf } from './law-map-outline'

/** "N to confirm" opens what waits and every branch above it, so the row it scrolls to is one a person can see. */

const revision = (type: RevisionView['type'], recordId: string, body: Record<string, unknown>): RevisionView => ({
  revisionId: `rev-${recordId}`,
  recordId,
  type,
  createdBy: 'author',
  citations: [{ url: 'https://gazette.xa.example/1', quote: 'the words on the page' }],
  claims: Object.entries(body).map(([path, value]) => ({ path, value, decision: null })),
})

const REVISIONS = [
  revision('territory', 'XA', { kind: 'country', name: 'Xanadu', parents: [] }),
  revision('territory', 'XA-1', { kind: 'state', name: 'Nordland', parents: [{ id: 'XA' }] }),
  revision('work', 'work:to-n', { kind: 'ordinance', title: 'Technical Ordinance Nordland', territoryIds: ['XA-1'] }),
  revision('work', 'work:mc-2', { kind: 'model_code', title: 'Fire', identifiers: { designation: 'MC 2' }, territoryIds: ['XA'] }),
  revision('edition', 'edition:mc-2-2023', { workId: 'work:mc-2', label: 'Edition 2023' }),
  revision('relation', 'relation:n-2-23', { relationType: 'makes_binding', mode: 'declared', fromId: 'work:to-n', fromType: 'work', toId: 'edition:mc-2-2023', toType: 'edition', validFrom: '2024-03-01' }),
]

describe('branchesOf', () => {
  const map = lawMapOf('XA', REVISIONS, [])
  const units = new Map(reviewUnitsOf(map, { revisions: REVISIONS, captures: [], texts: [] }).map((unit) => [unit.key, unit]))

  it('opens a series’ year under the works, and a statement under its region', () => {
    expect(branchesOf(map, units.get('batch:MC 2023')!)).toEqual(['works'])
    expect(branchesOf(map, units.get('work:to-n|2024-03-01')!)).toEqual(['XA-1'])
  })
})

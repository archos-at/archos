/**
 * @vitest-environment node
 *
 * The law a project's page shows is the law its turn reads (ADR-0175): the
 * chain's editions with their role, from the same records, under the same gate.
 * Where the gate refuses, nothing is named; a chain that cannot be read says
 * so, never "no law here".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { buildingLawForTurn, knowledgeContextForTurn } = vi.hoisted(() => ({
  buildingLawForTurn: vi.fn(),
  knowledgeContextForTurn: vi.fn(),
}))
vi.mock('../chain/turn', () => ({ buildingLawForTurn }))
vi.mock('./service', () => ({ knowledgeContextForTurn }))

import { gateNamesLaw, projectLawFor } from './project-law'
import type { GateState, KnowledgeContext } from './wire'

const contextAt = (state: GateState): KnowledgeContext => ({
  gate: { state, reason: null, leaves: [] },
  packs: [],
  chains: {},
  date: '2026-11-10',
  procedures: [],
  uses: [],
  retrieval: { countries: [] },
})

const STYRIA = {
  text: 'In der Steiermark gilt …',
  chain: ['AT-6', 'AT', 'EU'],
  date: '2026-11-10',
  uses: [
    { workId: 'work:stmk-bg', editionId: 'edition:stmk-bg-2023', role: 'binding', qualifier: null, via: 'territory', corpusFiles: [], designation: 'Stmk. BauG', editionLabel: 'LGBl. 2023/1' },
    { workId: 'work:oib-rl-2', editionId: 'edition:oib-rl-2-2019', role: 'binding', qualifier: null, via: 'relation', corpusFiles: ['oib-rl-2-2019.pdf'], designation: 'OIB-RL 2', editionLabel: '2019' },
    { workId: 'work:oib-rl-2', editionId: 'edition:oib-rl-2-2023', role: 'guidance', qualifier: null, via: 'relation', corpusFiles: ['oib-rl-2-2023.pdf'], designation: 'OIB-RL 2', editionLabel: '2023' },
  ],
}

describe('projectLawFor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeContextForTurn.mockResolvedValue(contextAt('core'))
    buildingLawForTurn.mockResolvedValue(STYRIA)
  })

  it('names the chain’s editions with the role the turn reads: OIB-RL 2:2019 binds in Styria, 2023 guides', async () => {
    const law = await projectLawFor('org_1', 'project_1')
    expect(law.gate).toBe('core')
    expect(law.uses.map((use) => [use.designation, use.editionLabel, use.role])).toEqual([
      ['Stmk. BauG', 'LGBl. 2023/1', 'binding'],
      ['OIB-RL 2', '2019', 'binding'],
      ['OIB-RL 2', '2023', 'guidance'],
    ])
    expect(buildingLawForTurn).toHaveBeenCalledWith('org_1', 'project_1')
    expect(knowledgeContextForTurn).toHaveBeenCalledWith('org_1', 'project_1', undefined, null, 'operation')
  })

  it.each(['organization_unplaced', 'site_unknown', 'not_entitled', 'knowledge_unavailable', 'none'] as const)(
    'names nothing where the gate is %s, whatever the chain holds',
    async (state) => {
      knowledgeContextForTurn.mockResolvedValue(contextAt(state))
      expect(await projectLawFor('org_1', 'project_1')).toEqual({ gate: state, uses: [] })
    },
  )

  it('says the law could not be read when the chain read fails, never that none applies', async () => {
    buildingLawForTurn.mockRejectedValue(new Error('database gone'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await projectLawFor('org_1', 'project_1')).toEqual({ gate: 'knowledge_unavailable', uses: [] })
  })

  it('reuses a context the caller already resolved', async () => {
    await projectLawFor('org_1', 'project_1', contextAt('open'))
    expect(knowledgeContextForTurn).not.toHaveBeenCalled()
  })

  it('lets every coverage level but none name law', () => {
    expect(gateNamesLaw('core')).toBe(true)
    expect(gateNamesLaw('none')).toBe(false)
  })
})

/**
 * @vitest-environment node
 *
 * The server-side record of which edition an answer used (E25, ADR-0173), and
 * whether the base moved since the last answer (E42). The role, the edition
 * and the sequences are the BFF's own; the backend's cited files only choose.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { turnContextOf, insertValues } = vi.hoisted(() => ({ turnContextOf: vi.fn(), insertValues: vi.fn() }))
vi.mock('./turn-snapshot', () => ({ turnContextOf }))
vi.mock('@/lib/db', () => ({
  getDb: () => ({ insert: () => ({ values: (rows: unknown) => ({ onConflictDoNothing: async () => insertValues(rows) }) }) }),
}))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: async (_scope: unknown, run: () => Promise<unknown>) => run() }))

import { citedFiles, editionUsesOf, recordEditionUses } from './edition-uses'
import { packsUpdatedSince } from './last-answer'
import type { KnowledgeContext } from './wire'

const editionUse = (workId: string, editionId: string | null, corpusFiles: string[]): KnowledgeContext['uses'][number] => ({
  workId,
  editionId,
  role: 'binding',
  qualifier: null,
  via: 'relation',
  date: '2026-12-14',
  freshness: 'current',
  lastCheckedAt: null,
  connectsBy: ['site'],
  labels: [],
  corpusFiles,
  designation: null,
  editionLabel: null,
  sourceRefs: [],
})

const CONTEXT: KnowledgeContext = {
  gate: { state: 'core', reason: null, leaves: [] },
  packs: [
    { packId: 'AT', seq: 41 },
    { packId: 'EU', seq: 7 },
  ],
  chains: {},
  date: '2026-12-14',
  procedures: [],
  uses: [
    editionUse('work:oib-rl-2', 'edition:oib-rl-2-2019', ['OIB-RL2-2019.pdf']),
    editionUse('work:oib-rl-6', 'edition:oib-rl-6-2025', ['OIB-RL6-2025.pdf']),
  ],
  text: null,
  retrieval: { countries: ['AT', 'EU'] },
}

describe('the editions an answer used', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the cited files off the backend sources, and nothing else', () => {
    expect(citedFiles({ sources: [{ file_name: 'OIB-RL2-2019.pdf' }, { url: 'https://x' }, 'junk'] })).toEqual(new Set(['OIB-RL2-2019.pdf']))
    expect(citedFiles(undefined)).toEqual(new Set())
  })

  it('records only the uses whose text the answer cited, at the context’s pack sequences', () => {
    expect(editionUsesOf(CONTEXT, new Set(['OIB-RL2-2019.pdf']))).toEqual([
      { workId: 'work:oib-rl-2', editionId: 'edition:oib-rl-2-2019', role: 'binding', qualifier: null, packSeqs: { AT: 41, EU: 7 } },
    ])
    expect(editionUsesOf(CONTEXT, new Set())).toEqual([])
  })

  it('writes one row per used edition of each answer, with the role the BFF resolved', async () => {
    turnContextOf.mockResolvedValue(CONTEXT)
    const written = await recordEditionUses('org_1', 'project_1', 'conv_1', [
      { id: 'm1', role: 'assistant', metadata: { sources: [{ file_name: 'OIB-RL6-2025.pdf' }] } },
      { id: 'm0', role: 'user', metadata: { sources: [{ file_name: 'OIB-RL2-2019.pdf' }] } },
    ])
    expect(written).toBe(1)
    expect(insertValues).toHaveBeenCalledWith([
      expect.objectContaining({ messageId: 'm1', organizationId: 'org_1', projectId: 'project_1', editionId: 'edition:oib-rl-6-2025', role: 'binding' }),
    ])
  })

  it('records the pack sequences the turn was answered on, not a release that landed since (E42)', async () => {
    // The turn read AT at 41; AT 42 was released before the answer persisted. The snapshot is the turn's.
    turnContextOf.mockResolvedValue(CONTEXT)
    await recordEditionUses('org_1', 'project_1', 'conv_1', [
      { id: 'm1', role: 'assistant', metadata: { sources: [{ file_name: 'OIB-RL6-2025.pdf' }] } },
    ])
    expect(turnContextOf).toHaveBeenCalledWith('org_1', 'conv_1')
    expect(insertValues).toHaveBeenCalledWith([expect.objectContaining({ packSeqs: { AT: 41, EU: 7 } })])
  })

  it('writes nothing with the flag off, or outside a project', async () => {
    turnContextOf.mockResolvedValue(undefined)
    const answer = { id: 'm1', role: 'assistant', metadata: { sources: [{ file_name: 'OIB-RL6-2025.pdf' }] } }
    expect(await recordEditionUses('org_1', 'project_1', 'conv_1', [answer])).toBe(0)
    expect(await recordEditionUses('org_1', null, 'conv_1', [answer])).toBe(0)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('never costs the answer its row when the record fails', async () => {
    turnContextOf.mockRejectedValue(new Error('down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const answer = { id: 'm1', role: 'assistant', metadata: { sources: [{ file_name: 'OIB-RL6-2025.pdf' }] } }
    await expect(recordEditionUses('org_1', 'project_1', 'conv_1', [answer])).resolves.toBe(0)
  })
})

describe('E42: the base moved since the last answer', () => {
  it('names a pack released since the last answer’s sequence', () => {
    expect(packsUpdatedSince(CONTEXT.packs, { AT: 40, EU: 7 })).toEqual(['AT'])
  })

  it('names nothing when nothing moved, or no answer recorded a use', () => {
    expect(packsUpdatedSince(CONTEXT.packs, { AT: 41, EU: 7 })).toEqual([])
    expect(packsUpdatedSince(CONTEXT.packs, null)).toEqual([])
  })
})

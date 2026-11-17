/**
 * @vitest-environment node
 *
 * A background run never calls the turn context, so it carries the law of its
 * project itself (ADR-0175): one knowledge context, chain text included, under
 * the key the worker binds (`knowledge_context`), and no second payload beside
 * it. Without it a research run for an Austrian project would read as
 * `knowledge_unavailable` and withhold the law the chat turn names.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { knowledgeContextForTurn, submitJob, isTemporaryConversation } = vi.hoisted(() => ({
  knowledgeContextForTurn: vi.fn(),
  isTemporaryConversation: vi.fn(async () => false),
  submitJob: vi.fn(async () => ({ jobId: 'job_1', queued: true })),
}))
vi.mock('@/lib/base-knowledge/context/service', () => ({ knowledgeContextForTurn }))
vi.mock('./backend-client', () => ({ submitJob }))
vi.mock('@/lib/conversations/temporary', () => ({ isTemporaryConversation }))
vi.mock('@/lib/request-context', () => ({ buildRequestContextWireHeaders: () => ({}), encodeBudgetHeader: () => null }))
vi.mock('./run-context', () => ({ runRequestContextInput: () => ({}), warnIfRunEnvelopeLarge: () => undefined }))

import type { RunContext } from './run-context'
import { submitBackgroundRun } from './background-run'

const STYRIA_CONTEXT = {
  gate: { state: 'core', reason: null, leaves: [{ territoryId: 'AT-6', country: 'AT', certainty: 'verified', entitled: true, coverage: 'core', municipalLaw: null }] },
  packs: [{ packId: 'at', seq: 3 }],
  chains: { 'AT-6': ['AT-6', 'AT', 'EU'] },
  date: '2026-11-10',
  procedures: [],
  uses: [
    {
      workId: 'work:oib-rl-2',
      editionId: 'edition:oib-rl-2-2019',
      role: 'binding',
      qualifier: null,
      via: 'relation',
      date: '2026-11-10',
      freshness: 'current',
      lastCheckedAt: null,
      connectsBy: ['site'],
      labels: [],
      corpusFiles: ['oib-rl-2-2019.pdf'],
      designation: 'OIB-RL 2',
      editionLabel: '2019',
      sourceRefs: [],
    },
  ],
  text: 'Building law at this site, Steiermark …',
  retrieval: { countries: ['AT', 'EU'] },
}

const submit = (conversationId: string | null = null) =>
  submitBackgroundRun({
    subject: { organizationId: 'org_at', projectId: 'project_graz', userId: 'user_1' },
    ownerEmail: null,
    prompt: 'Welche Brandschutzanforderungen gelten?',
    skills: [],
    output: 'deep-research',
    conversationId,
    dataSources: null,
    priority: 'bulk',
    context: { collectionScope: null, projectContext: null, projectMemory: null, memoryReflectionEnabled: false, modelOverrides: null, budget: null } as unknown as RunContext,
  })

const payload = () => (submitJob.mock.calls[0] as unknown as [Record<string, unknown>])[0]

describe('submitBackgroundRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeContextForTurn.mockResolvedValue(STYRIA_CONTEXT)
    isTemporaryConversation.mockResolvedValue(false)
  })

  it('tells the worker when the run’s conversation is temporary, and says nothing otherwise', async () => {
    await submit('conv_1')
    expect(isTemporaryConversation).toHaveBeenCalledWith('conv_1', 'org_at')
    expect(payload()).not.toHaveProperty('temporary_conversation')

    submitJob.mockClear()
    isTemporaryConversation.mockResolvedValue(true)
    await submit('conv_1')
    expect(payload()).toMatchObject({ temporary_conversation: true })
  })

  it('still submits the run when the flag cannot be read', async () => {
    isTemporaryConversation.mockRejectedValue(new Error('database away'))
    await submit('conv_1')
    expect(submitJob).toHaveBeenCalledTimes(1)
    expect(payload()).not.toHaveProperty('temporary_conversation')
  })

  it('carries the knowledge context of an entitled Austrian project, chain text included, read for its office and project', async () => {
    await submit()
    expect(knowledgeContextForTurn).toHaveBeenCalledWith('org_at', 'project_graz', undefined, null, 'run')
    expect(payload()).toMatchObject({ knowledge_context: STYRIA_CONTEXT })
  })

  it('carries no second payload for the law beside the context (one answer, ADR-0175)', async () => {
    await submit()
    expect(payload()).not.toHaveProperty('building_law')
  })

  it('carries the unavailable gate as it is: the worker fails closed on it, never on a missing key', async () => {
    const unavailable = { ...STYRIA_CONTEXT, gate: { state: 'knowledge_unavailable', reason: null, leaves: [] }, uses: [], text: null, retrieval: { countries: [] } }
    knowledgeContextForTurn.mockResolvedValue(unavailable)
    await submit()
    expect(payload().knowledge_context).toEqual(unavailable)
  })
})

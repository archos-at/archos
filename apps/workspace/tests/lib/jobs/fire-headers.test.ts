// @disk-inputs: bff/jobs/background-run.ts, bff/jobs/service.ts, bff/jobs/run-context.ts, bff/jobs/backend-client.ts, bff/request-context.ts
/**
 * @vitest-environment node
 *
 * The BFF half of the job fire path's header contract (ledger item 10).
 *
 * ADR-0046's Risks section is the reason this file exists, and it says the
 * lesson better than a comment can: the backend's route guard read
 * `x-internal-token` while every caller in the repo sent
 * `x-grid-internal-token`, so **every scheduled run 403'd in a real
 * deployment** — and nothing caught it, "because the two sides are tested
 * separately and each test pinned its own spelling". A fire path has no human
 * on it, so a silent 403 is indistinguishable from a quiet week.
 *
 * The fix that ADR asked for was "a test that crosses the service boundary
 * rather than two that agree with themselves". This is one of its two halves:
 * a shared fixture (`apps/workspace/tests/fixtures/job_fire_headers.json`) names the headers,
 * this spec asserts the BFF really puts them on the wire, and
 * `packages/agent/tests/test_fire_path_contract.py` asserts what the Python side
 * demands is a subset of the same file. Neither side can move a name alone.
 *
 * It asserts against what `submitJob` ACTUALLY sends — a stubbed `fetch`
 * capturing the real request — rather than against a second list of header
 * names, which would just be a third thing that agrees with itself.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import fixture from '../../fixtures/job_fire_headers.json'

import { submitJob, type JobSubmitPayload } from '@/lib/jobs/backend-client'
import { submitBackgroundRun, type BackgroundRunSubmission } from '@/lib/jobs/background-run'
import type { RunContext } from '@/lib/jobs/run-context'
import { submitAgentRun } from '@/lib/jobs/service'
import {
  buildRequestContextWireHeaders,
  type RequestContextInput,
} from '@/lib/request-context'

vi.mock('@/lib/jobs/backend-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/backend-client')>()
  return { ...actual, submitJob: vi.fn(actual.submitJob) }
})

vi.mock('@/lib/jobs/background-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/background-run')>()
  return { ...actual, submitBackgroundRun: vi.fn(actual.submitBackgroundRun) }
})

vi.mock('@/lib/jobs/run-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/run-context')>()
  return { ...actual, resolveRunContext: vi.fn(async () => runContext) }
})

vi.mock('@/lib/base-knowledge/context/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/base-knowledge/context/service')>()
  return {
    ...actual,
    knowledgeContextForTurn: vi.fn(async () => ({
      gate: { state: 'knowledge_unavailable', reason: null, leaves: [] },
      packs: [],
      chains: {},
      date: '2026-11-10',
      procedures: [],
      uses: [],
      text: null,
      retrieval: { countries: [] },
    })),
  }
})

vi.mock('@/lib/conversations/temporary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/conversations/temporary')>()
  return { ...actual, isTemporaryConversation: vi.fn(async () => false) }
})

const INTERNAL_TOKEN = 'test-internal-token'

const { runContext } = vi.hoisted(() => ({
  runContext: {
    budget: { remainingOrgUsd: 42.5, remainingUserUsd: 10, remainingProjectUsd: 5.25 },
    modelOverrides: { deep_research: 'openrouter/anthropic/claude-3.7-sonnet' },
    collectionScope: ['oib_knowledge', 'proj_proj_789'],
    projectContext: 'Projekt: Wohnbau Simmering',
    projectMemory: '- Bevorzugt knappe Zitate',
    orgInstructions: null,
    federalState: 'vienna',
    memoryReflectionEnabled: true,
    requester: null,
  },
}))

const CONTEXT_INPUT: RequestContextInput = {
  organizationId: 'org_123',
  userId: 'user_456',
  projectId: 'proj_789',
  collectionScope: ['oib_knowledge', 'proj_proj_789'],
  projectContext: 'Projekt: Wohnbau Simmering',
  projectMemory: '- Bevorzugt knappe Zitate',
  modelOverrides: { deep_research: 'openrouter/anthropic/claude-3.7-sonnet' },
  budget: { remainingOrgUsd: 42.5, remainingUserUsd: 10, remainingProjectUsd: 5.25 },
  federalState: 'vienna',
  memoryReflectionEnabled: true,
}

const PAYLOAD: JobSubmitPayload = {
  input: 'Prüfe den Einreichplan gegen OIB-Richtlinie 4.',
  skills: [],
  output: 'deep-research',
  data_sources: ['knowledge_layer'],
  collection_scope: ['oib_knowledge', 'proj_proj_789'],
  project_context: CONTEXT_INPUT.projectContext ?? null,
  project_memory: CONTEXT_INPUT.projectMemory ?? null,
  memory_reflection_enabled: true,
  organization_id: 'org_123',
  user_id: 'user_456',
  project_id: 'proj_789',
  owner_email: 'ziviltechniker@example.at',
  budget_header: null,
  model_overrides: CONTEXT_INPUT.modelOverrides ?? null,
  knowledge_context: {
    gate: { state: 'knowledge_unavailable', reason: null, leaves: [] },
    packs: [],
    chains: {},
    date: '2026-11-10',
    procedures: [],
    uses: [],
    text: null,
    retrieval: { countries: [] },
  },
}

const RUN: BackgroundRunSubmission = {
  subject: { organizationId: 'org_123', projectId: 'proj_789', userId: 'user_456' },
  ownerEmail: 'ziviltechniker@example.at',
  prompt: PAYLOAD.input,
  skills: [],
  output: 'deep-research',
  conversationId: null,
  dataSources: ['knowledge_layer'],
  priority: 'interactive',
  context: runContext as unknown as RunContext,
}

const lower = (names: string[]): string[] => names.map((name) => name.toLowerCase())

function stubFetch() {
  const captured: { headers: Record<string, string>; body: { input?: string } } = { headers: {}, body: {} }
  const fetchSpy = vi.fn(async (_url: unknown, init: RequestInit) => {
    captured.headers = Object.fromEntries(new Headers(init.headers as HeadersInit).entries())
    captured.body = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ jobId: 'job_abc' }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchSpy)
  return { fetchSpy, captured }
}

async function capturedFireHeaders(
  input: RequestContextInput = CONTEXT_INPUT
): Promise<Record<string, string>> {
  const { fetchSpy, captured } = stubFetch()

  const headers = buildRequestContextWireHeaders(input, process.env.INTERNAL_API_TOKEN)
  await submitJob(PAYLOAD, headers)

  expect(fetchSpy).toHaveBeenCalledTimes(1)
  return captured.headers
}

describe('the headers the BFF puts on a job fire', () => {
  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_TOKEN', INTERNAL_TOKEN)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubEnv('INTERNAL_API_TOKEN', undefined)
  })

  it('sends every header the shared fixture names', async () => {
    const sent = await capturedFireHeaders()
    const missing = lower(fixture.sentByBff).filter((name) => !(name in sent))

    expect(missing, `the fire path stopped sending: ${missing.join(', ')}`).toEqual([])
  })

  it('sends the internal token under the spelling the backend guard accepts', async () => {
    const sent = await capturedFireHeaders()
    const accepted = lower(fixture.internalTokenAcceptedSpellings)
    const used = accepted.filter((name) => sent[name] === INTERNAL_TOKEN)

    expect(used.length, `no accepted internal-token header carried the token`).toBeGreaterThan(0)
  })

  it('sends the signed context envelope, exemption notwithstanding', async () => {
    const sent = await capturedFireHeaders()

    for (const name of lower(fixture.contextEnvelope)) {
      expect(sent[name], `missing ${name}`).toBeTruthy()
    }
  })

  it('spells the worker identity headers the way the worker synthesises them', async () => {
    const sent = await capturedFireHeaders()

    const onTheWire = (name: string) => name.replace(/^x-grid-/, 'x-')
    expect(lower(fixture.workerIdentityHeaders).filter((name) => !(onTheWire(name) in sent))).toEqual([])
    expect(sent['x-organization-id']).toBe('org_123')
    expect(sent['x-project-id']).toBe('proj_789')
    expect(sent['x-user-id']).toBe('user_456')
  })

  it('still carries the floor when every optional context lookup came back empty', async () => {
    const sent = await capturedFireHeaders({
      organizationId: 'org_new',
      userId: 'user_new',
      projectId: 'proj_new',
      collectionScope: ['oib_knowledge'],
      memoryReflectionEnabled: false,
    })

    expect(lower(fixture.requiredOnEveryFire).filter((name) => !(name in sent))).toEqual([])
    expect(sent['x-grid-model-overrides']).toBeUndefined()
    expect(sent['x-grid-budget']).toBeUndefined()
  })

  it('refuses to fire at all rather than sending an unauthenticated submit', async () => {
    vi.stubEnv('INTERNAL_API_TOKEN', undefined)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(submitJob(PAYLOAD, {})).rejects.toThrow(/INTERNAL_API_TOKEN/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the fire path in lib/jobs/background-run.ts', () => {
  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_TOKEN', INTERNAL_TOKEN)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubEnv('INTERNAL_API_TOKEN', undefined)
  })

  it('builds its headers with the shared wire builder, and the fire carries them', async () => {
    const { captured } = stubFetch()

    await submitBackgroundRun(RUN)

    expect(captured.headers['x-internal-token']).toBe(INTERNAL_TOKEN)
    expect(captured.headers['x-organization-id']).toBe('org_123')
    for (const name of lower(fixture.contextEnvelope)) {
      expect(captured.headers[name], `missing ${name}`).toBeTruthy()
    }
  })

  it('hands those headers, and not a second object, to submitJob', async () => {
    const { captured } = stubFetch()

    await submitBackgroundRun(RUN)

    const passed = vi.mocked(submitJob).mock.lastCall?.[1] ?? {}
    expect(Object.keys(passed).length).toBeGreaterThan(0)
    for (const [name, value] of Object.entries(passed)) {
      expect(captured.headers[name.toLowerCase()], name).toBe(value)
    }
  })

  it('is the one way submitAgentRun reaches submitJob', async () => {
    const { fetchSpy, captured } = stubFetch()

    await submitAgentRun({
      organizationId: 'org_123',
      projectId: 'proj_789',
      userId: 'user_456',
      ownerEmail: 'ziviltechniker@example.at',
      title: null,
      prompt: PAYLOAD.input,
      skillSnapshot: null,
      output: 'deep-research',
      dataSources: ['knowledge_layer'],
      runId: 'run_1',
      conversationId: null,
    })

    expect(vi.mocked(submitBackgroundRun)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(submitJob)).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(captured.body.input).toBe(PAYLOAD.input)
    expect(captured.headers['x-internal-token']).toBe(INTERNAL_TOKEN)
  })
})

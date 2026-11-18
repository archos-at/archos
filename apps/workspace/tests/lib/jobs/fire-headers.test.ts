// @disk-inputs: bff/jobs/background-run.ts, bff/jobs/service.ts
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
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import fixture from '../../fixtures/job_fire_headers.json'

import { submitJob, type JobSubmitPayload } from '@/lib/jobs/backend-client'
import {
  buildRequestContextWireHeaders,
  type RequestContextInput,
} from '@/lib/request-context'

const INTERNAL_TOKEN = 'test-internal-token'

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

const lower = (names: string[]): string[] => names.map((name) => name.toLowerCase())

async function capturedFireHeaders(
  input: RequestContextInput = CONTEXT_INPUT
): Promise<Record<string, string>> {
  let sent: Record<string, string> = {}
  const fetchSpy = vi.fn(async (_url: unknown, init: RequestInit) => {
    sent = Object.fromEntries(new Headers(init.headers as HeadersInit).entries())
    return new Response(JSON.stringify({ jobId: 'job_abc' }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchSpy)

  const headers = buildRequestContextWireHeaders(input, process.env.INTERNAL_API_TOKEN)
  await submitJob(PAYLOAD, headers)

  expect(fetchSpy).toHaveBeenCalledTimes(1)
  return sent
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
  const read = (path: string) => readFileSync(new URL(`../../../bff/jobs/${path}`, import.meta.url), 'utf8')
  const fire = read('background-run.ts')

  it('builds its headers with the shared wire builder', () => {
    expect(fire).toContain('buildRequestContextWireHeaders(')
    expect(fire).toContain('process.env.INTERNAL_API_TOKEN')
  })

  it('hands those headers, and not a second object, to submitJob', () => {
    expect(fire).toContain('return submitJob(payload, contextHeaders)')
  })

  it('is the one way submitAgentRun reaches submitJob', () => {
    const service = read('service.ts')
    expect(service).toContain('await submitBackgroundRun(')
    expect(service).not.toMatch(/\bsubmitJob\(/)
  })
})

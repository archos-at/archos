/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_GROUPS } from './agent-groups'
import {
  BOOTSTRAP_ACTOR,
  BOOTSTRAP_DEFAULT_MODEL,
  bootstrapPlatformModelDefaults,
  groupsEligibleForBootstrap,
} from './bootstrap-defaults'
import type { LlmBaseUrls } from './backend-defaults'

vi.mock('server-only', () => ({}))

const OPENROUTER = 'https://openrouter.ai/api/v1'

function allOn(baseUrl: string | null): LlmBaseUrls {
  return Object.fromEntries(
    AGENT_GROUPS.flatMap((group) => group.configLlmRefs).map((ref) => [ref, baseUrl]),
  )
}

const getPlatformModelDefaults = vi.fn()
const savePlatformModelDefaults = vi.fn()
vi.mock('./platform-defaults', () => ({
  getPlatformModelDefaults: (): unknown => getPlatformModelDefaults(),
  savePlatformModelDefaults: (input: unknown, executor?: unknown): unknown =>
    savePlatformModelDefaults(input, executor),
}))

const getWorkflowLlmBaseUrls = vi.fn()
vi.mock('./backend-defaults', () => ({
  getWorkflowLlmBaseUrls: (): unknown => getWorkflowLlmBaseUrls(),
}))

const fetchModelCatalog = vi.fn()
const fetchZdrEndpoints = vi.fn()
const validateOverrides = vi.fn()
vi.mock('./openrouter', () => ({
  fetchModelCatalog: (): unknown => fetchModelCatalog(),
  fetchZdrEndpoints: (): unknown => fetchZdrEndpoints(),
  validateOverrides: (...args: unknown[]): unknown => validateOverrides(...args),
}))

const zdrIndex = (...ids: string[]): Map<string, unknown[]> =>
  new Map(ids.map((modelId) => [modelId, [{ modelId, supportedParameters: ['tools'], contextLength: 1048576 }]]))

const recordAuditEvent = vi.fn()
vi.mock('@/lib/audit/service', () => ({
  recordAuditEvent: (input: unknown): unknown => recordAuditEvent(input),
}))
vi.mock('@/lib/authz/platform', () => ({
  getPlatformOrganizationId: async (): Promise<string> => 'org_platform',
}))

let executeResults: unknown[][] = []
const tx = { execute: async () => executeResults.shift() ?? [] }
vi.mock('@/lib/db', () => ({
  getDb: () => ({
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  }),
}))

function freshDeployment(): void {
  getPlatformModelDefaults.mockResolvedValue({})
  executeResults = [[{ locked: true }], [{ count: 0 }], []]
}

describe('groupsEligibleForBootstrap', () => {
  it('accepts every group when the whole workflow runs on the platform provider', () => {
    expect(groupsEligibleForBootstrap(allOn(OPENROUTER)).sort()).toEqual(
      AGENT_GROUPS.map((group) => group.id).sort(),
    )
  })

  it('refuses every group on a deployment pointed at another provider', () => {
    expect(groupsEligibleForBootstrap(allOn('https://api.kimi.com/coding/v1'))).toEqual([])
    expect(groupsEligibleForBootstrap(allOn('https://api.openai.com/v1'))).toEqual([])
  })

  it('refuses a group whose endpoint is unknown rather than assuming OpenRouter', () => {
    expect(groupsEligibleForBootstrap(allOn(null))).toEqual([])
    expect(groupsEligibleForBootstrap({})).toEqual([])
  })

  it('refuses a group when only SOME of its LLMs are on the platform provider', () => {
    const deepResearch = AGENT_GROUPS.find((group) => group.id === 'deep_research')
    expect(deepResearch?.configLlmRefs.length).toBeGreaterThan(1)
    const mixed: LlmBaseUrls = {
      ...allOn(OPENROUTER),
      [deepResearch!.configLlmRefs[0]]: 'https://api.openai.com/v1',
    }
    expect(groupsEligibleForBootstrap(mixed)).not.toContain('deep_research')
    expect(groupsEligibleForBootstrap(mixed)).toContain('shallow_research')
  })

  it('leaves ingest_vlm out when the ingestion VLM is on its own provider', () => {
    const vlmElsewhere: LlmBaseUrls = {
      ...allOn(OPENROUTER),
      vlm: 'https://api.openai.com/v1',
    }
    const eligible = groupsEligibleForBootstrap(vlmElsewhere)
    expect(eligible).not.toContain('ingest_vlm')
    expect(eligible).toContain('shallow_research')
  })

  it('is not fooled by a look-alike host', () => {
    expect(groupsEligibleForBootstrap(allOn('https://notopenrouter.ai/v1'))).toEqual([])
    expect(groupsEligibleForBootstrap(allOn('https://openrouter.ai.evil.test/v1'))).toEqual([])
    expect(groupsEligibleForBootstrap(allOn('not a url'))).toEqual([])
  })

  it('accepts a real subdomain', () => {
    expect(groupsEligibleForBootstrap(allOn('https://eu.openrouter.ai/api/v1')).length).toBe(
      AGENT_GROUPS.length,
    )
  })
})

describe('bootstrapPlatformModelDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('APP_DATABASE_URL', 'postgres://stub')
    executeResults = []
    getWorkflowLlmBaseUrls.mockResolvedValue(allOn(OPENROUTER))
    fetchModelCatalog.mockResolvedValue([{ id: BOOTSTRAP_DEFAULT_MODEL }])
    fetchZdrEndpoints.mockResolvedValue(zdrIndex(BOOTSTRAP_DEFAULT_MODEL))
    validateOverrides.mockImplementation((_catalog: unknown, defaults: Record<string, string>) => ({
      ok: true,
      errors: {},
      snapshot: Object.fromEntries(
        Object.keys(defaults).map((group) => [group, { id: BOOTSTRAP_DEFAULT_MODEL }]),
      ),
    }))
    savePlatformModelDefaults.mockResolvedValue([])
    recordAuditEvent.mockResolvedValue(undefined)
  })

  it('provisions every eligible group and records what it wrote', async () => {
    freshDeployment()

    const written = await bootstrapPlatformModelDefaults()

    expect(written.sort()).toEqual(AGENT_GROUPS.map((group) => group.id).sort())
    const input = savePlatformModelDefaults.mock.calls[0][0]
    expect(new Set(Object.values(input.defaults))).toEqual(new Set([BOOTSTRAP_DEFAULT_MODEL]))
    expect(input.actorUserId).toBe(BOOTSTRAP_ACTOR)
    expect(input.modelSnapshot.shallow_research).toEqual({ id: BOOTSTRAP_DEFAULT_MODEL })
  })

  it('records an audit event for a decision no human made', async () => {
    freshDeployment()

    await bootstrapPlatformModelDefaults()

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform.model_defaults.bootstrapped',
        organizationId: 'org_platform',
        actor: { userId: BOOTSTRAP_ACTOR, email: null },
      }),
    )
  })

  it('does nothing when the deployment already has defaults', async () => {
    getPlatformModelDefaults.mockResolvedValue({ shallow_research: 'vendor/owner-pick' })

    expect(await bootstrapPlatformModelDefaults()).toEqual([])
    expect(savePlatformModelDefaults).not.toHaveBeenCalled()
  })

  it('does nothing when rows appeared between the pre-check and the lock', async () => {
    getPlatformModelDefaults.mockResolvedValue({})
    executeResults = [[{ locked: true }], [{ count: 7 }], []]

    expect(await bootstrapPlatformModelDefaults()).toEqual([])
    expect(savePlatformModelDefaults).not.toHaveBeenCalled()
  })

  it('leaves the deployment alone when the backend cannot be asked', async () => {
    freshDeployment()
    getWorkflowLlmBaseUrls.mockRejectedValue(new Error('backend down'))

    expect(await bootstrapPlatformModelDefaults()).toEqual([])
    expect(savePlatformModelDefaults).not.toHaveBeenCalled()
  })

  it('writes nothing on a deployment running another provider', async () => {
    freshDeployment()
    getWorkflowLlmBaseUrls.mockResolvedValue(allOn('https://api.kimi.com/coding/v1'))

    expect(await bootstrapPlatformModelDefaults()).toEqual([])
    expect(savePlatformModelDefaults).not.toHaveBeenCalled()
  })

  it('provisions only the eligible groups on a mixed-provider deployment', async () => {
    freshDeployment()
    getWorkflowLlmBaseUrls.mockResolvedValue({
      ...allOn(OPENROUTER),
      vlm: 'https://api.openai.com/v1',
    })

    const written = await bootstrapPlatformModelDefaults()

    expect(written).not.toContain('ingest_vlm')
    expect(written).toContain('shallow_research')
    expect(Object.keys(savePlatformModelDefaults.mock.calls[0][0].defaults)).not.toContain(
      'ingest_vlm',
    )
  })

  it('refuses to write an unvalidated id when the catalog is unavailable', async () => {
    freshDeployment()
    fetchModelCatalog.mockRejectedValue(new Error('catalog down'))

    expect(await bootstrapPlatformModelDefaults()).toEqual([])
    expect(savePlatformModelDefaults).not.toHaveBeenCalled()
  })

  it('refuses to write a model that fails a group capability gate', async () => {
    freshDeployment()
    validateOverrides.mockReturnValue({
      ok: false,
      errors: {
        deep_research: [
          {
            code: 'context_too_small',
            message: 'context length 32768 is below the required 131072',
            params: { actual: 32768, required: 131072 },
          },
        ],
      },
      snapshot: {},
    })

    expect(await bootstrapPlatformModelDefaults()).toEqual([])
    expect(savePlatformModelDefaults).not.toHaveBeenCalled()
  })

  it('refuses to write anything when the ZDR list is unreachable (fail closed)', async () => {
    freshDeployment()
    fetchZdrEndpoints.mockRejectedValue(new Error('zdr listing down'))

    expect(await bootstrapPlatformModelDefaults()).toEqual([])
    expect(savePlatformModelDefaults).not.toHaveBeenCalled()
  })

  it('refuses a bootstrap model without a zero-data-retention endpoint, and says so', async () => {
    freshDeployment()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    validateOverrides.mockReturnValue({
      ok: false,
      errors: {
        deep_research: [{ code: 'not_zdr', message: 'no zero-data-retention endpoint', params: {} }],
      },
      snapshot: {},
    })

    expect(await bootstrapPlatformModelDefaults()).toEqual([])
    expect(savePlatformModelDefaults).not.toHaveBeenCalled()
    expect(String(error.mock.calls[0]?.[0])).toContain('no zero-data-retention endpoint')
    error.mockRestore()
  })

  it('validates with the ZDR list before writing', async () => {
    freshDeployment()
    const zdr = zdrIndex(BOOTSTRAP_DEFAULT_MODEL)
    fetchZdrEndpoints.mockResolvedValue(zdr)

    await bootstrapPlatformModelDefaults()

    expect(validateOverrides.mock.calls[0][3]).toBe(zdr)
    expect(savePlatformModelDefaults).toHaveBeenCalled()
  })

  it('keeps the defaults when the audit sink fails', async () => {
    freshDeployment()
    recordAuditEvent.mockRejectedValue(new Error('workos down'))

    expect(await bootstrapPlatformModelDefaults()).not.toEqual([])
    expect(savePlatformModelDefaults).toHaveBeenCalled()
  })

  it('takes the lock, re-checks and writes on ONE connection', async () => {
    freshDeployment()

    await bootstrapPlatformModelDefaults()

    expect(savePlatformModelDefaults.mock.calls[0][1]).toBe(tx)
  })

  it('writes nothing when another replica holds the lock', async () => {
    getPlatformModelDefaults.mockResolvedValue({})
    executeResults = [[{ locked: false }]]

    expect(await bootstrapPlatformModelDefaults()).toEqual([])
    expect(savePlatformModelDefaults).not.toHaveBeenCalled()
  })

  it('never throws into boot when the database is unreachable', async () => {
    vi.stubEnv('APP_DATABASE_URL', 'postgres://stub')
    getPlatformModelDefaults.mockRejectedValue(new Error('db down'))

    await expect(bootstrapPlatformModelDefaults()).resolves.toEqual([])
    vi.unstubAllEnvs()
  })

  it('skips quietly when no application database is configured', async () => {
    vi.stubEnv('APP_DATABASE_URL', '')

    expect(await bootstrapPlatformModelDefaults()).toEqual([])
    expect(getPlatformModelDefaults).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})

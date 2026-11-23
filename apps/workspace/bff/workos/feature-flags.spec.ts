/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listOrganizationFeatureFlags = vi.fn()

function paginated(...pages: { slug: string }[][]) {
  return {
    data: pages[0] ?? [],
    autoPagination: async () => pages.flat(),
  }
}

vi.mock('./client', () => ({
  getWorkOS: () => ({ featureFlags: { listOrganizationFeatureFlags } }),
}))

import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import { LEGACY_FLAG_KEYS } from '@/lib/authz/legacy-feature-flags'
import {
  _clearFeatureFlagCache,
  enabledPostAnswerStages,
  isDeepResearchEnabledForOrg,
  isMemoryReflectionEnabled,
  isOrgFeatureEnabled,
  isTaskAutomationEnabledForOrg,
  POST_ANSWER_STAGE_FLAGS,
} from './feature-flags'

const MEMORY_REFLECTION = FEATURE_FLAGS.memoryReflection

beforeEach(async () => {
  vi.stubEnv('REQUIRE_AUTH', 'true')
  vi.stubEnv('WORKOS_API_KEY', 'sk_test')
  await _clearFeatureFlagCache('org-1')
  listOrganizationFeatureFlags.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isOrgFeatureEnabled', () => {
  it('is true when the slug is among the org’s enabled flags', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: MEMORY_REFLECTION }, { slug: 'other' }]))
    await expect(isOrgFeatureEnabled(MEMORY_REFLECTION, 'org-1')).resolves.toBe(true)
    expect(listOrganizationFeatureFlags).toHaveBeenCalledWith({ organizationId: 'org-1' })
  })

  it('reads past the first page, because the endpoint returns ten at a time', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(
      paginated(Array.from({ length: 10 }, (_, i) => ({ slug: `filler-${i}` })), [
        { slug: MEMORY_REFLECTION },
      ]),
    )

    await expect(isOrgFeatureEnabled(MEMORY_REFLECTION, 'org-1')).resolves.toBe(true)
  })

  it('asks for no explicit limit, or the SDK short-circuits to one page', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: MEMORY_REFLECTION }]))

    await isOrgFeatureEnabled(MEMORY_REFLECTION, 'org-1')

    expect(listOrganizationFeatureFlags).toHaveBeenCalledWith({ organizationId: 'org-1' })
  })

  it('is false when the slug is not enabled for the org', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: 'other' }]))
    await expect(isOrgFeatureEnabled(MEMORY_REFLECTION, 'org-1')).resolves.toBe(false)
  })

  it('is false when there is no org, whatever kind the flag is', async () => {
    await expect(isOrgFeatureEnabled(MEMORY_REFLECTION, null)).resolves.toBe(false)
    await expect(isOrgFeatureEnabled(FEATURE_FLAGS.deepResearch, undefined)).resolves.toBe(false)
    expect(listOrganizationFeatureFlags).not.toHaveBeenCalled()
  })

  it('is false when there is no WorkOS API key', async () => {
    vi.stubEnv('WORKOS_API_KEY', '')
    await expect(isOrgFeatureEnabled(MEMORY_REFLECTION, 'org-1')).resolves.toBe(false)
    expect(listOrganizationFeatureFlags).not.toHaveBeenCalled()
  })

  it('fails closed when evaluation throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    listOrganizationFeatureFlags.mockRejectedValue(new Error('feature not on plan'))
    await expect(isOrgFeatureEnabled(MEMORY_REFLECTION, 'org-1')).resolves.toBe(false)
  })

  it('caches per org (no second WorkOS call within the TTL)', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: MEMORY_REFLECTION }]))
    await isOrgFeatureEnabled(MEMORY_REFLECTION, 'org-1')
    await isOrgFeatureEnabled(MEMORY_REFLECTION, 'org-1')
    expect(listOrganizationFeatureFlags).toHaveBeenCalledTimes(1)
  })

  it.each([
    FEATURE_FLAGS.threadReplies,
    FEATURE_FLAGS.agentActs,
    FEATURE_FLAGS.agentNotices,
    FEATURE_FLAGS.agentAsk,
  ])('%s is on for its new key, and for the key it had before the rename', async (flag) => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: flag }]))
    await expect(isOrgFeatureEnabled(flag, 'org-1')).resolves.toBe(true)

    await _clearFeatureFlagCache('org-1')
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: String(LEGACY_FLAG_KEYS[flag]) }]))
    await expect(isOrgFeatureEnabled(flag, 'org-1')).resolves.toBe(true)
  })
})

describe('a deployment that authenticates nobody (REQUIRE_AUTH not true)', () => {
  beforeEach(() => {
    vi.stubEnv('REQUIRE_AUTH', 'false')
  })

  it('serves every rollout, with or without an organization, and asks WorkOS nothing', async () => {
    await expect(isOrgFeatureEnabled(MEMORY_REFLECTION, 'org-1')).resolves.toBe(true)
    await expect(isMemoryReflectionEnabled(undefined)).resolves.toBe(true)
    await expect(enabledPostAnswerStages(undefined)).resolves.toEqual(['memory_reflection', 'follow_ups'])
    expect(listOrganizationFeatureFlags).not.toHaveBeenCalled()
  })

  it('withholds every entitlement — deep research and tasks included', async () => {
    await expect(isDeepResearchEnabledForOrg(undefined)).resolves.toBe(false)
    await expect(isTaskAutomationEnabledForOrg('org-1')).resolves.toBe(false)
    await expect(isOrgFeatureEnabled(FEATURE_FLAGS.skills, 'org-1')).resolves.toBe(false)
    expect(listOrganizationFeatureFlags).not.toHaveBeenCalled()
  })

  it('ignores a WorkOS key that happens to be configured', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: FEATURE_FLAGS.deepResearch }]))
    await expect(isDeepResearchEnabledForOrg('org-1')).resolves.toBe(false)
    expect(listOrganizationFeatureFlags).not.toHaveBeenCalled()
  })
})

describe('the capabilities the agent reads per turn', () => {
  it('deep research is OFF for a caller with no organization — it used to fail open', async () => {
    await expect(isDeepResearchEnabledForOrg(undefined)).resolves.toBe(false)
    await expect(isDeepResearchEnabledForOrg(null)).resolves.toBe(false)
    expect(listOrganizationFeatureFlags).not.toHaveBeenCalled()
  })

  it('tasks are OFF for a caller with no organization, the same way', async () => {
    await expect(isTaskAutomationEnabledForOrg(undefined)).resolves.toBe(false)
  })

  it('both follow the organization’s flag', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: FEATURE_FLAGS.deepResearch }]))
    await expect(isDeepResearchEnabledForOrg('org-1')).resolves.toBe(true)
    await expect(isTaskAutomationEnabledForOrg('org-1')).resolves.toBe(false)
  })
})

describe('isMemoryReflectionEnabled', () => {
  it('follows the per-org WorkOS flag', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: MEMORY_REFLECTION }]))
    await expect(isMemoryReflectionEnabled('org-1')).resolves.toBe(true)
  })

  it('fails closed when the org lacks the flag', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: 'other' }]))
    await expect(isMemoryReflectionEnabled('org-1')).resolves.toBe(false)
  })

  it('reads no environment fallback — MEMORY_REFLECTION_ENABLED is gone', async () => {
    vi.stubEnv('MEMORY_REFLECTION_ENABLED', 'true')
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: 'other' }]))
    await expect(isMemoryReflectionEnabled('org-1')).resolves.toBe(false)
  })
})

describe('enabledPostAnswerStages', () => {
  it('mirrors the backend stage ids, not the flag slugs', () => {
    expect(POST_ANSWER_STAGE_FLAGS.map((stage) => stage.id)).toEqual(['memory_reflection', 'follow_ups'])
  })

  it('lists a stage whose flag is on for the org', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: MEMORY_REFLECTION }]))
    await expect(enabledPostAnswerStages('org-1')).resolves.toEqual(['memory_reflection'])
  })

  it('omits a stage whose flag is off — the kill switch, per turn', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: 'other' }]))
    await expect(enabledPostAnswerStages('org-1')).resolves.toEqual([])
  })

  it('agrees with isMemoryReflectionEnabled — one source of truth', async () => {
    listOrganizationFeatureFlags.mockResolvedValue(paginated([{ slug: 'other' }]))
    const [viaStages, viaLegacy] = [await enabledPostAnswerStages('org-1'), await isMemoryReflectionEnabled('org-1')]
    expect(viaStages.includes('memory_reflection')).toBe(viaLegacy)
  })
})

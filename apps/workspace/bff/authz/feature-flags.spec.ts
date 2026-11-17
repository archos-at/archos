/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FEATURE_FLAGS,
  FLAG_KINDS,
  REGISTRY_FLAG_SLUGS,
  flagsFromWorkOS,
  isAgentActsEnabled,
  isAgentAskEnabled,
  isAgentAuthoredDocumentsEnabled,
  isAgentNoticesEnabled,
  isAgentWakesEnabled,
  isCollaborationEnabled,
  isFeatureEnabled,
  isIfcModelsEnabled,
  isMailImportEnabled,
  isProjectKnowledgePageEnabled,
  isSkillsEnabled,
  requireFeature,
  requireSkillsEnabled,
  type KnownFeatureFlag,
} from './feature-flags'
import { LEGACY_FLAG_KEYS } from './legacy-feature-flags'

const FLAG = FEATURE_FLAGS.modelConfiguration

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the registry', () => {
  it('contains the known flags with their WorkOS slugs', () => {
    expect(FEATURE_FLAGS.modelConfiguration).toBe('runtime-model-config')
    expect(FEATURE_FLAGS.deepResearch).toBe('deep-research')
    expect(FEATURE_FLAGS.memoryReflection).toBe('memory-reflection')
    expect(FEATURE_FLAGS.postAnswerFollowUps).toBe('post-answer-follow-ups')
  })

  it('classifies every slug, and nothing that is not one', () => {
    expect(Object.keys(FLAG_KINDS).sort()).toEqual([...REGISTRY_FLAG_SLUGS].sort())
  })

  it('keeps the entitlements that cost money or widen who reads what OFF where nobody signs in', () => {
    const entitlements = REGISTRY_FLAG_SLUGS.filter((slug) => FLAG_KINDS[slug] === 'entitlement').sort()
    expect(entitlements).toEqual(
      [
        'agent-direct-edits',
        'agent-mcp',
        'agent-mcp-access',
        'agent-mcp-controls',
        'agent-mcp-secrets',
        'agent-requests',
        'agent-thread-replies',
        'byok-llm',
        'collaboration',
        'deep-research',
        'folder-cards',
        'inbound-mail',
        'licensed-seam',
        'mail-import',
        'office-conventions',
        'office-standards',
        'platform-agent-mcp',
        'revision-suggestions',
        'runtime-model-config',
        'skills',
        'source-monitors',
        'task-automation',
      ].sort()
    )
  })
})

describe('the switches the cut-over removed (ADR-0175)', () => {
  const RETIRED = ['knowledge-context', 'building-law-chain', 'time-editions', 'office-base-knowledge', 'platform-base-knowledge']

  it.each(RETIRED)('%s is not in the registry', (slug) => {
    expect(REGISTRY_FLAG_SLUGS as readonly string[]).not.toContain(slug)
    expect(Object.keys(FLAG_KINDS)).not.toContain(slug)
  })
})

describe('where people sign in (REQUIRE_AUTH=true): WorkOS decides, fail-closed', () => {
  beforeEach(() => {
    vi.stubEnv('REQUIRE_AUTH', 'true')
  })

  it('reads flags from WorkOS', () => {
    expect(flagsFromWorkOS()).toBe(true)
  })

  it('passes only sessions carrying the flag slug', () => {
    expect(isFeatureEnabled({ featureFlags: [FLAG] }, FLAG)).toBe(true)
    expect(isFeatureEnabled({ featureFlags: ['other-flag'] }, FLAG)).toBe(false)
    expect(isFeatureEnabled({ featureFlags: [] }, FLAG)).toBe(false)
  })

  it('fails a token without the claim closed (stale session)', () => {
    expect(isFeatureEnabled({ featureFlags: null }, FLAG)).toBe(false)
  })

  it('gives a rollout no default either — absent from the claim is off', () => {
    expect(isIfcModelsEnabled({ featureFlags: [] })).toBe(false)
    expect(isAgentAuthoredDocumentsEnabled({ featureFlags: [] })).toBe(false)
    expect(isIfcModelsEnabled({ featureFlags: [FEATURE_FLAGS.ifcModels] })).toBe(true)
  })

  it('ignores every retired environment fallback', () => {
    for (const name of [
      'SKILLS_ENABLED',
      'COLLABORATION_ENABLED',
      'MAIL_IMPORT_ENABLED',
      'PROJECT_KNOWLEDGE_PAGE_ENABLED',
    ]) {
      vi.stubEnv(name, 'true')
    }
    vi.stubEnv('IFC_MODELS_ENABLED', 'true')
    const none = { featureFlags: [] }
    expect(isSkillsEnabled(none)).toBe(false)
    expect(isCollaborationEnabled(none)).toBe(false)
    expect(isMailImportEnabled(none)).toBe(false)
    expect(isProjectKnowledgePageEnabled(none)).toBe(false)
    expect(isIfcModelsEnabled(none)).toBe(false)
  })

  it.each(REGISTRY_FLAG_SLUGS)('requireFeature refuses %s with the one feature-disabled problem (RFC 9457)', async (flag) => {
    const res = requireFeature({ featureFlags: [] }, flag)
    expect(res?.status).toBe(403)
    expect(res?.headers.get('content-type')).toContain('application/problem+json')
    const body = await res?.json()
    expect(body).toEqual({
      type: 'urn:problem-type:feature-disabled',
      title: 'Forbidden',
      status: 403,
      code: 'feature_disabled',
      detail: expect.stringContaining(`feature flag \`${flag}\``),
      error: body.detail,
      feature: flag,
    })
    expect(body.detail).toMatch(/switches it on per organization/)
    expect(requireFeature({ featureFlags: [flag] }, flag)).toBeNull()
  })

  it('requireSkillsEnabled: null when allowed, stable-coded 403 when off', async () => {
    expect(requireSkillsEnabled({ featureFlags: [FEATURE_FLAGS.skills] })).toBeNull()
    const res = requireSkillsEnabled({ featureFlags: [] })
    expect(res?.status).toBe(403)
    expect(await res?.json()).toMatchObject({ code: 'feature_disabled', feature: 'skills' })
  })
})

describe('where nobody signs in (REQUIRE_AUTH unset): rollouts on, entitlements off', () => {
  beforeEach(() => {
    vi.stubEnv('REQUIRE_AUTH', '')
  })

  it('does not read flags from WorkOS', () => {
    expect(flagsFromWorkOS()).toBe(false)
  })

  it('answers each flag by its kind, whatever the session carries', () => {
    for (const slug of REGISTRY_FLAG_SLUGS) {
      const expected = FLAG_KINDS[slug] === 'rollout'
      for (const featureFlags of [null, [], [slug]] as (KnownFeatureFlag[] | null)[]) {
        expect(isFeatureEnabled({ featureFlags }, slug), `${slug} ${JSON.stringify(featureFlags)}`).toBe(
          expected
        )
      }
    }
  })

  it('so the model surfaces and filing are on, and skills and collaboration are not', () => {
    expect(isIfcModelsEnabled({ featureFlags: null })).toBe(true)
    expect(isAgentAuthoredDocumentsEnabled({ featureFlags: null })).toBe(true)
    expect(isProjectKnowledgePageEnabled({ featureFlags: null })).toBe(true)
    expect(isSkillsEnabled({ featureFlags: null })).toBe(false)
    expect(isCollaborationEnabled({ featureFlags: null })).toBe(false)
    expect(isMailImportEnabled({ featureFlags: null })).toBe(false)
    expect(isFeatureEnabled({ featureFlags: null }, FEATURE_FLAGS.deepResearch)).toBe(false)
  })

  it('is not talked into an entitlement by a retired environment variable', () => {
    vi.stubEnv('SKILLS_ENABLED', 'true')
    vi.stubEnv('ENFORCE_FEATURE_FLAGS', 'true')
    expect(isSkillsEnabled({ featureFlags: [FEATURE_FLAGS.skills] })).toBe(false)
  })
})

describe('the agent switches renamed in WorkOS (ADR-0149): either key turns the feature on', () => {
  beforeEach(() => {
    vi.stubEnv('REQUIRE_AUTH', 'true')
  })

  it('names the four new keys and keeps the four old ones only in the legacy module', () => {
    expect(FEATURE_FLAGS.threadReplies).toBe('agent-thread-replies')
    expect(FEATURE_FLAGS.agentActs).toBe('agent-direct-edits')
    expect(FEATURE_FLAGS.agentNotices).toBe('revision-suggestions')
    expect(FEATURE_FLAGS.agentAsk).toBe('agent-requests')
    expect(Object.keys(LEGACY_FLAG_KEYS).sort()).toEqual(
      ['agent-direct-edits', 'agent-requests', 'agent-thread-replies', 'revision-suggestions'].sort()
    )
  })

  it.each([
    ['isAgentWakesEnabled', isAgentWakesEnabled, 'agent-thread-replies'],
    ['isAgentActsEnabled', isAgentActsEnabled, 'agent-direct-edits'],
    ['isAgentNoticesEnabled', isAgentNoticesEnabled, 'revision-suggestions'],
    ['isAgentAskEnabled', isAgentAskEnabled, 'agent-requests'],
  ])('%s is on for the new key and for the key it had, and off for neither', (_name, enabled, slug) => {
    expect(LEGACY_FLAG_KEYS[slug]).toBeDefined()
    expect(enabled({ featureFlags: [slug] })).toBe(true)
    expect(enabled({ featureFlags: [String(LEGACY_FLAG_KEYS[slug])] })).toBe(true)
    expect(enabled({ featureFlags: [] })).toBe(false)
    expect(enabled({ featureFlags: null })).toBe(false)
  })

  it('lets requireFeature pass for the key it had, so the office keeps the feature until the contract step', () => {
    expect(requireFeature({ featureFlags: [String(LEGACY_FLAG_KEYS['agent-direct-edits'])] }, FEATURE_FLAGS.agentActs)).toBeNull()
    expect(requireFeature({ featureFlags: ['agent-direct-edits'] }, FEATURE_FLAGS.agentActs)).toBeNull()
  })

  it('keeps the old keys out of the registry, so provisioning reports only the new names', () => {
    for (const legacy of Object.values(LEGACY_FLAG_KEYS)) {
      expect(REGISTRY_FLAG_SLUGS as readonly string[]).not.toContain(legacy)
    }
  })
})

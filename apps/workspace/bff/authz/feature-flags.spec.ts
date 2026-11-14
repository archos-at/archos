/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FEATURE_FLAGS,
  FLAG_KINDS,
  REGISTRY_FLAG_SLUGS,
  flagsFromWorkOS,
  isAgentAuthoredDocumentsEnabled,
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
    // `FLAG_KINDS` is a Record over the slug union, so tsc already refuses a
    // missing entry; this pins that the runtime object agrees.
    expect(Object.keys(FLAG_KINDS).sort()).toEqual([...REGISTRY_FLAG_SLUGS].sort())
  })

  it('keeps the entitlements that cost money or widen who reads what OFF where nobody signs in', () => {
    const entitlements = REGISTRY_FLAG_SLUGS.filter((slug) => FLAG_KINDS[slug] === 'entitlement').sort()
    expect(entitlements).toEqual(
      [
        'agent-mcp',
        'agent-mcp-access',
        'agent-mcp-controls',
        'agent-mcp-secrets',
        'byok-llm',
        'collaboration',
        'deep-research',
        'folder-cards',
        'inbound-mail',
        'licensed-seam',
        'mail-import',
        'office-conventions',
        // The office's own standards: what the office records reaches its answers (ADR-0163).
        'office-standards',
        'piloti-acts',
        'piloti-ask',
        'piloti-notices',
        'piloti-wakes',
        'platform-agent-mcp',
        'runtime-model-config',
        'skills',
        // Not a cost or a widening: a sweep that fetches public sources and opens review work (ADR-0174).
        'source-monitors',
        'task-automation',
      ].sort()
    )
  })
})

describe('the switches the cut-over removed (ADR-0175)', () => {
  // Which office reads which country is its entitlement rows, never a switch:
  // a slug coming back would bring a second, silent answer to that question.
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
    // The default-ON env gates (`IFC_MODELS_ENABLED`,
    // `AGENT_AUTHORED_DOCUMENTS_ENABLED`) are gone; what WorkOS says is
    // what the session gets.
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

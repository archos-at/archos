/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authz/organizations', () => ({
  canManageSkills: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/authz/feature-flags', () => ({
  requireSkillsEnabled: vi.fn().mockReturnValue(null),
}))

vi.mock('./repository', () => ({
  insertSkill: vi.fn(),
  listSkillsInOrg: vi.fn(),
  findSkill: vi.fn(),
  findSkillByName: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  listCuratedSkillActivations: vi.fn(),
  upsertCuratedSkillActivation: vi.fn(),
}))

vi.mock('./platform-skills', () => ({
  listPlatformSkills: vi.fn(),
  findPlatformSkill: vi.fn(),
}))

vi.mock('./platform-repository', () => ({
  listPublishedOfferRows: vi.fn(),
}))

vi.mock('./skill-category-repository', () => ({
  CATEGORIES_LIST_LIMIT: 100,
  listCategoriesForOrg: vi.fn(),
  listOrgCategories: vi.fn(),
  findCategoryInScope: vi.fn(),
  findPlatformSkillCategory: vi.fn(),
  findOrgCategoryByName: vi.fn(),
  findPlatformSkillCategoryByName: vi.fn(),
  findOrgCategory: vi.fn(),
  insertCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  orgCategoryValues: vi.fn((organizationId, values) => ({ ...values, organizationId })),
}))

import { canManageSkills } from '@/lib/authz/organizations'
import { requireSkillsEnabled } from '@/lib/authz/feature-flags'
import * as repository from './repository'
import * as categoryRepository from './skill-category-repository'
import * as platformRepository from './platform-repository'
import { findPlatformSkill, listPlatformSkills } from './platform-skills'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { Skill } from '@/lib/db/schema/jobs'
import type { PlatformSkillRow } from '@/lib/db/schema/platform-skills'
import {
  listSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  listSkillCategories,
  createSkillCategory,
  updateSkillCategory,
  deleteSkillCategory,
  resolveSkillSnapshot,
  resolveSkillsForAgent,
  resolveSelectableSkills,
  listInvocableSkills,
  setCuratedSkillEnabled,
  searchSkills,
  readSkill,
} from './service'

type Session = Parameters<typeof listSkills>[0]

const session: Session = {
  userId: 'user_1',
  email: 'user@example.com',
  name: null,
  accessToken: 'tok',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  role: 'member',
  permissions: [],
  featureFlags: null,
}

const PLATFORM_SKILL = {
  name: 'data-table-analysis',
  description: 'Analyze tables.',
  body: '# Data Table Analysis Skill\n\nCompute deterministically.',
  metadata: {},
  origin: 'platform' as const,
  collection: 'research' as const,
}

const CURATED_SKILL = {
  name: 'oib-fire-check',
  description: 'Checks the project against OIB fire safety.',
  body: '# Fire check\n\nAct as a fire-safety reviewer.',
  metadata: { 'grid-catalog': 'curated' },
  origin: 'platform' as const,
  collection: 'research' as const,
}

const DEEP_ONLY_SKILL = {
  name: 'forecast-analysis',
  description: 'Forecast evidence for a deep-research job.',
  body: '# Forecast\n\nUse execute.',
  metadata: { 'grid-catalog': 'curated', 'grid-agents': 'deep_researcher' },
  origin: 'platform' as const,
  collection: 'research' as const,
}

function activation(name: string, enabled: boolean) {
  return {
    organizationId: 'org_1',
    skillName: name,
    enabled,
    updatedBy: 'user_1',
    updatedByEmail: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

function platformRow(overrides: Partial<PlatformSkillRow> = {}): PlatformSkillRow {
  const base: PlatformSkillRow = {
    id: 'ps-1',
    name: 'energy-check',
    description: 'Reviews the energy certificate.',
    body: 'Compare the certificate against OIB 6.',
    metadata: {},
    published: true,
    delivery: 'offer',
    categoryId: null,
    createdBy: 'owner',
    createdByEmail: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
  return { ...base, ...overrides }
}

const HOUSE_ROW = platformRow({
  id: 'ps-house',
  name: 'house-citation-style',
  description: 'Always cite the OIB paragraph number.',
  body: 'Cite every normative claim with its OIB paragraph.',
})

function publishPlatformRows(rows: PlatformSkillRow[]): void {
  vi.mocked(platformRepository.listPublishedOfferRows).mockResolvedValue(
    rows.filter((row) => row.published)
  )
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  const base: Skill = {
    id: 'skill-1',
    organizationId: 'org_1',
    name: 'my-skill',
    description: 'Does the thing.',
    body: 'Body.',
    metadata: {},
    origin: 'org',
    clonedFrom: null,
    categoryId: null,
    enabled: true,
    createdBy: 'user_1',
    createdByEmail: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  }
  return { ...base, ...overrides }
}

function makeCategory(
  overrides: Partial<{
    id: string
    organizationId: string | null
    name: string
    description: string | null
    slug: string | null
    sortOrder: number
  }> = {}
) {
  return {
    id: 'cat-1',
    organizationId: null,
    name: 'Recherche',
    description: null,
    slug: null,
    sortOrder: 0,
    createdBy: 'owner',
    createdByEmail: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(requireSkillsEnabled).mockReturnValue(null)
  vi.mocked(canManageSkills).mockReturnValue(true)
  vi.mocked(listPlatformSkills).mockReturnValue([PLATFORM_SKILL, CURATED_SKILL])
  vi.mocked(findPlatformSkill).mockImplementation(
    (name) => [PLATFORM_SKILL, CURATED_SKILL].find((skill) => skill.name === name) ?? null
  )
  vi.mocked(repository.listSkillsInOrg).mockResolvedValue([])
  vi.mocked(repository.listCuratedSkillActivations).mockResolvedValue([])
  publishPlatformRows([])
  vi.mocked(repository.findSkill).mockResolvedValue(null)
  vi.mocked(repository.findSkillByName).mockResolvedValue(null)
  vi.mocked(categoryRepository.listCategoriesForOrg).mockResolvedValue([])
  vi.mocked(categoryRepository.listOrgCategories).mockResolvedValue([])
  vi.mocked(categoryRepository.findCategoryInScope).mockResolvedValue(null)
  vi.mocked(categoryRepository.findOrgCategoryByName).mockResolvedValue(null)
  vi.mocked(categoryRepository.findOrgCategory).mockResolvedValue(null)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('feature gate', () => {
  it('rejects every session call when the skills feature is off', async () => {
    vi.mocked(requireSkillsEnabled).mockReturnValue({ status: 403 } as Response)
    await expect(listSkills(session)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      createSkill(session, { name: 'a', description: 'b', body: 'c' })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('listSkills', () => {
  it('lists org rows and the platform OFFERS, never the pipeline machinery', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ id: 'skill-2', name: 'org-only' }),
    ])
    const { skills } = await listSkills(session)
    expect(skills.map((s) => s.name)).toEqual(['oib-fire-check', 'org-only'])
    expect(skills.map((s) => s.name)).not.toContain('data-table-analysis')
    expect(skills.find((s) => s.name === 'org-only')?.id).toBe('skill-2')
  })

  it('starts a deep-research-only file offer OFF, and keeps it out of chat', async () => {
    vi.mocked(listPlatformSkills).mockReturnValue([PLATFORM_SKILL, CURATED_SKILL, DEEP_ONLY_SKILL])
    vi.mocked(findPlatformSkill).mockImplementation(
      (name) =>
        [PLATFORM_SKILL, CURATED_SKILL, DEEP_ONLY_SKILL].find((skill) => skill.name === name) ?? null
    )
    const { skills } = await listSkills(session)
    expect(skills.find((s) => s.name === 'forecast-analysis')).toMatchObject({
      enabled: false,
      origin: 'platform',
    })
    const { skills: chat } = await resolveSkillsForAgent('org_1', 'researcher')
    expect(chat.map((s) => s.name)).not.toContain('forecast-analysis')
    const { skills: deep } = await resolveSkillsForAgent('org_1', 'deep_researcher')
    expect(deep.map((s) => s.name)).not.toContain('forecast-analysis')
    const { skills: invocable } = await listInvocableSkills(session)
    expect(invocable.map((s) => s.name)).not.toContain('forecast-analysis')
  })

  it('starts a chat-usable file offer ON, and still lets the org switch it off', async () => {
    const { skills } = await listSkills(session)
    const offer = skills.find((s) => s.name === 'oib-fire-check')
    expect(offer).toMatchObject({ id: null, origin: 'platform', enabled: true })

    vi.mocked(repository.listCuratedSkillActivations).mockResolvedValue([
      activation('oib-fire-check', false),
    ])
    const { skills: after } = await listSkills(session)
    expect(after.find((s) => s.name === 'oib-fire-check')?.enabled).toBe(false)
  })

  it('offers a published platform_skills row to the organization', async () => {
    publishPlatformRows([platformRow({ metadata: { 'grid-agents': 'deep_researcher' } })])
    const { skills } = await listSkills(session)
    const offer = skills.find((s) => s.name === 'energy-check')
    expect(offer).toMatchObject({ id: null, origin: 'platform', enabled: false })
    expect(offer?.body).toBe('Compare the certificate against OIB 6.')
    expect(offer?.metadata['grid-agents']).toBe('deep_researcher')
  })

  it('does not let a dashboard offer replace a shipped file of the same name', async () => {
    publishPlatformRows([
      platformRow({ name: 'oib-fire-check', body: 'DASHBOARD OVERRIDE' }),
    ])
    const { skills } = await listSkills(session)
    expect(skills.find((s) => s.name === 'oib-fire-check')?.body).toBe(CURATED_SKILL.body)
    const { skills: forTheRun } = await resolveSkillsForAgent('org_1')
    expect(forTheRun.find((s) => s.name === 'oib-fire-check')?.body).toBe(CURATED_SKILL.body)
  })

  it('lets an org row shadow an offer of the same name, as it always has', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ name: 'oib-fire-check', description: 'org shadow' }),
    ])
    const { skills } = await listSkills(session)
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ description: 'org shadow', origin: 'org' })
  })
})

describe('setCuratedSkillEnabled', () => {
  it('requires org:skills:manage', async () => {
    vi.mocked(canManageSkills).mockReturnValue(false)
    await expect(setCuratedSkillEnabled(session, 'oib-fire-check', true)).rejects.toBeInstanceOf(
      ForbiddenError
    )
  })

  it('stores the decision by name and reports the new state', async () => {
    vi.mocked(repository.upsertCuratedSkillActivation).mockResolvedValue(
      activation('oib-fire-check', true)
    )
    const { skill } = await setCuratedSkillEnabled(session, 'oib-fire-check', true)
    expect(repository.upsertCuratedSkillActivation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        skillName: 'oib-fire-check',
        enabled: true,
      })
    )
    expect(skill).toMatchObject({ name: 'oib-fire-check', enabled: true })
  })

  it('refuses to switch the pipeline machinery, and stores nothing', async () => {
    await expect(
      setCuratedSkillEnabled(session, 'data-table-analysis', false)
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(setCuratedSkillEnabled(session, 'no-such-skill', true)).rejects.toBeInstanceOf(
      NotFoundError
    )
    expect(repository.upsertCuratedSkillActivation).not.toHaveBeenCalled()
  })
})

describe('createSkill', () => {
  it('requires org:skills:manage', async () => {
    vi.mocked(canManageSkills).mockReturnValue(false)
    await expect(
      createSkill(session, { name: 'a', description: 'b', body: 'c' })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('conflicts on a duplicate name in the same org', async () => {
    vi.mocked(repository.findSkillByName).mockResolvedValue(makeSkill())
    await expect(
      createSkill(session, { name: 'my-skill', description: 'b', body: 'c' })
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('records a clone with origin platform-clone when clonedFrom is set', async () => {
    vi.mocked(repository.insertSkill).mockImplementation(async (values) => makeSkill(values))
    await createSkill(session, {
      name: 'clone-1',
      description: 'b',
      body: 'c',
      clonedFrom: 'data-table-analysis',
    })
    expect(repository.insertSkill).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'platform-clone', clonedFrom: 'data-table-analysis' })
    )
  })
})

describe('updateSkill / deleteSkill', () => {
  it('updates only the given fields and re-checks conflict on rename', async () => {
    vi.mocked(repository.findSkill).mockResolvedValue(makeSkill())
    vi.mocked(repository.updateSkill).mockImplementation(async (id, orgId, values) =>
      makeSkill(values)
    )
    await updateSkill(session, 'skill-1', { description: 'new' })
    expect(repository.updateSkill).toHaveBeenCalledWith(
      'skill-1',
      'org_1',
      expect.objectContaining({ description: 'new' })
    )

    vi.mocked(repository.findSkillByName).mockResolvedValue(makeSkill({ id: 'other' }))
    await expect(updateSkill(session, 'skill-1', { name: 'other' })).rejects.toBeInstanceOf(
      ConflictError
    )
  })

  it('404s on unknown skill ids', async () => {
    await expect(updateSkill(session, 'nope', {})).rejects.toBeInstanceOf(NotFoundError)
    await expect(deleteSkill(session, 'nope')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('resolveSkillSnapshot', () => {
  it('resolves org skills first, platform skills second, and 404s the rest', async () => {
    vi.mocked(repository.findSkillByName).mockResolvedValue(makeSkill())
    expect((await resolveSkillSnapshot('my-skill', 'org_1')).origin).toBe('org')

    vi.mocked(repository.findSkillByName).mockResolvedValue(null)
    expect((await resolveSkillSnapshot('data-table-analysis', 'org_1')).origin).toBe('platform')

    await expect(resolveSkillSnapshot('nope', 'org_1')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('answers machinery without consulting the catalogue at all', async () => {
    vi.mocked(repository.findSkillByName).mockResolvedValue(null)
    const snapshot = await resolveSkillSnapshot('data-table-analysis', 'org_1')
    expect(snapshot.origin).toBe('platform')
    expect(platformRepository.listPublishedOfferRows).not.toHaveBeenCalled()
    expect(repository.listCuratedSkillActivations).not.toHaveBeenCalled()
  })

  it('pins a chat-usable file offer without an activation row', async () => {
    vi.mocked(repository.findSkillByName).mockResolvedValue(null)
    expect((await resolveSkillSnapshot('oib-fire-check', 'org_1')).origin).toBe('platform')
  })

  it('will not pin a file offer the org has switched off', async () => {
    vi.mocked(repository.findSkillByName).mockResolvedValue(null)
    vi.mocked(repository.listCuratedSkillActivations).mockResolvedValue([
      activation('oib-fire-check', false),
    ])
    await expect(resolveSkillSnapshot('oib-fire-check', 'org_1')).rejects.toBeInstanceOf(
      NotFoundError
    )
  })
})

describe('resolveSkillsForAgent', () => {
  it('merges platform + enabled org rows, org shadowing platform, disabled excluded', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({
        name: 'data-table-analysis',
        description: 'org shadow',
        metadata: { 'grid-cards': 'summary' },
      }),
      makeSkill({ id: 's2', name: 'disabled-skill', enabled: false }),
    ])
    const { skills } = await resolveSkillsForAgent('org_1')
    const shadowed = skills.find((s) => s.name === 'data-table-analysis')
    expect(shadowed?.description).toBe('org shadow')
    expect(shadowed?.metadata['grid-cards']).toBe('summary')
    expect(skills.map((s) => s.name)).not.toContain('disabled-skill')
    expect(skills.map((s) => s.name)).toContain('oib-fire-check')
  })

  it('filters by grid-agents when an agent is named, absent meaning all', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ name: 'for-researcher', metadata: { 'grid-agents': 'deep_researcher' } }),
      makeSkill({ id: 's2', name: 'for-everyone' }),
    ])
    const { skills } = await resolveSkillsForAgent('org_1', 'deep_researcher')
    expect(skills.map((s) => s.name)).toEqual([
      'oib-fire-check',
      'data-table-analysis',
      'for-researcher',
      'for-everyone',
    ])
    const { skills: other } = await resolveSkillsForAgent('org_1', 'researcher')
    expect(other.map((s) => s.name)).toEqual(['oib-fire-check', 'data-table-analysis', 'for-everyone'])
  })

  it('filters by agents the same way for a skill that carries only the new key', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ name: 'for-researcher', metadata: { agents: 'deep_researcher' } }),
      makeSkill({ id: 's2', name: 'for-everyone' }),
    ])
    const { skills } = await resolveSkillsForAgent('org_1', 'deep_researcher')
    expect(skills.map((s) => s.name)).toEqual([
      'oib-fire-check',
      'data-table-analysis',
      'for-researcher',
      'for-everyone',
    ])
    const { skills: other } = await resolveSkillsForAgent('org_1', 'researcher')
    expect(other.map((s) => s.name)).toEqual(['oib-fire-check', 'data-table-analysis', 'for-everyone'])
  })

  it('ignores an unknown grid-agents name rather than hiding the skill from everyone', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ name: 'typo', metadata: { 'grid-agents': 'shallow_reseacher' } }),
    ])
    const { skills } = await resolveSkillsForAgent('org_1', 'researcher')
    expect(skills.map((s) => s.name)).toContain('typo')
  })

  it('reads the retired shallow_researcher name as the researcher, both ways', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ name: 'chat-only', metadata: { 'grid-agents': 'shallow_researcher' } }),
    ])
    const { skills: forChat } = await resolveSkillsForAgent('org_1', 'researcher')
    expect(forChat.map((s) => s.name)).toContain('chat-only')

    const { skills: forDeep } = await resolveSkillsForAgent('org_1', 'deep_researcher')
    expect(forDeep.map((s) => s.name)).not.toContain('chat-only')
  })

  it('answers a caller that still asks as shallow_researcher', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ name: 'chat-only', metadata: { 'grid-agents': 'researcher' } }),
      makeSkill({ id: 's2', name: 'deep-only', metadata: { 'grid-agents': 'deep_researcher' } }),
    ])
    const { skills } = await resolveSkillsForAgent('org_1', 'shallow_researcher')
    expect(skills.map((s) => s.name)).toContain('chat-only')
    expect(skills.map((s) => s.name)).not.toContain('deep-only')
  })

  it('runs the machinery for every org and a chat-usable file offer by default', async () => {
    const { skills } = await resolveSkillsForAgent('org_1')
    expect(skills.map((s) => s.name).sort()).toEqual(['data-table-analysis', 'oib-fire-check'])
  })

  it('drops an offer again when the org switches it back off', async () => {
    vi.mocked(repository.listCuratedSkillActivations).mockResolvedValue([
      activation('oib-fire-check', false),
    ])
    const { skills } = await resolveSkillsForAgent('org_1')
    expect(skills.map((s) => s.name)).not.toContain('oib-fire-check')
  })
})

describe('a published platform row, after the standard tier was retired', () => {
  beforeEach(() => {
    publishPlatformRows([HOUSE_ROW])
  })

  it('does not run until the organization switches it on', async () => {
    expect(await repository.listCuratedSkillActivations('org_1')).toEqual([])
    const { skills } = await resolveSkillsForAgent('org_1')
    expect(skills.map((s) => s.name)).not.toContain('house-citation-style')
  })

  it('appears on the org Skills tab, where the decision lives', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([makeSkill({ name: 'org-only' })])
    const { skills } = await listSkills(session)
    expect(skills.map((s) => s.name)).toContain('house-citation-style')
  })

  it('is switchable: the activation endpoint takes it and stores the decision', async () => {
    vi.mocked(repository.upsertCuratedSkillActivation).mockResolvedValue(
      activation('house-citation-style', true)
    )
    await expect(
      setCuratedSkillEnabled(session, 'house-citation-style', true)
    ).resolves.toBeTruthy()
    expect(repository.upsertCuratedSkillActivation).toHaveBeenCalledWith(
      expect.objectContaining({ skillName: 'house-citation-style', enabled: true })
    )
  })

  it('runs once switched on, and carries no flag telling the backend to force it', async () => {
    vi.mocked(repository.listCuratedSkillActivations).mockResolvedValue([
      activation('house-citation-style', true),
    ])
    const { skills } = await resolveSkillsForAgent('org_1')
    const row = skills.find((s) => s.name === 'house-citation-style')
    expect(row).toMatchObject({
      origin: 'platform',
      body: 'Cite every normative claim with its OIB paragraph.',
    })
    expect(Object.keys(row ?? {})).not.toContain('standard')
  })

  it('is shadowable: the org\'s own row of the same name wins', async () => {
    vi.mocked(repository.listCuratedSkillActivations).mockResolvedValue([
      activation('house-citation-style', true),
    ])
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ name: 'house-citation-style', body: 'Our own citation rule.' }),
    ])
    const { skills } = await resolveSkillsForAgent('org_1')
    expect(skills.find((s) => s.name === 'house-citation-style')).toMatchObject({
      origin: 'org',
      body: 'Our own citation rule.',
    })
  })

  it('no longer reserves its name against a tenant authoring one', async () => {
    vi.mocked(repository.findSkillByName).mockResolvedValue(null)
    vi.mocked(repository.insertSkill).mockImplementation(async (values) => makeSkill(values))
    await expect(
      createSkill(session, { name: 'house-citation-style', description: 'b', body: 'c' })
    ).resolves.toBeTruthy()
  })

  it('no longer refuses an edit to a row wearing its name', async () => {
    vi.mocked(repository.findSkill).mockResolvedValue(makeSkill({ name: 'house-citation-style' }))
    vi.mocked(repository.updateSkill).mockResolvedValue(
      makeSkill({ name: 'house-citation-style', body: 'NEW ORG BODY' })
    )
    await expect(
      updateSkill(session, 'skill-1', { body: 'NEW ORG BODY' })
    ).resolves.toBeTruthy()
  })

  it('is attachable to a job once the org has taken it up', async () => {
    vi.mocked(repository.listCuratedSkillActivations).mockResolvedValue([
      activation('house-citation-style', true),
    ])
    vi.mocked(repository.findSkillByName).mockResolvedValue(null)
    expect((await resolveSkillSnapshot('house-citation-style', 'org_1')).origin).toBe('platform')
  })

  it('yields to the machinery when a builtin ships under its name', async () => {
    publishPlatformRows([
      platformRow({ ...HOUSE_ROW, name: 'data-table-analysis', body: 'DASHBOARD OVERRIDE' }),
    ])
    const { skills } = await resolveSkillsForAgent('org_1')
    expect(skills.find((s) => s.name === 'data-table-analysis')?.body).toBe(PLATFORM_SKILL.body)

    vi.mocked(repository.findSkillByName).mockResolvedValue(null)
    expect((await resolveSkillSnapshot('data-table-analysis', 'org_1')).body).toBe(
      PLATFORM_SKILL.body
    )
  })

  it('still respects grid-agents', async () => {
    publishPlatformRows([
      platformRow({ ...HOUSE_ROW, metadata: { 'grid-agents': 'deep_researcher' } }),
    ])
    vi.mocked(repository.listCuratedSkillActivations).mockResolvedValue([
      activation('house-citation-style', true),
    ])
    const { skills: deep } = await resolveSkillsForAgent('org_1', 'deep_researcher')
    expect(deep.map((s) => s.name)).toContain('house-citation-style')
    const { skills: chat } = await resolveSkillsForAgent('org_1', 'researcher')
    expect(chat.map((s) => s.name)).not.toContain('house-citation-style')
  })

  it('is in the pickers a person reads, because it is theirs to pick now', async () => {
    vi.mocked(repository.listCuratedSkillActivations).mockResolvedValue([
      activation('house-citation-style', true),
    ])
    const { skills: selectable } = await resolveSelectableSkills('org_1')
    expect(selectable.map((s) => s.name)).toContain('house-citation-style')

    const { skills: invocable } = await listInvocableSkills(session)
    expect(invocable.map((s) => s.name)).toContain('house-citation-style')
  })
})

describe('listInvocableSkills', () => {
  it('never lists pipeline machinery — those load on their own', async () => {
    const { skills } = await listInvocableSkills(session)
    expect(skills.map((s) => s.name)).not.toContain('data-table-analysis')
    expect(skills.map((s) => s.name)).toContain('oib-fire-check')
  })

  it('lists a hidden org skill — hidden is the live line, not the menu', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ name: 'house-voice', metadata: { 'grid-hidden': 'true' } }),
    ])
    const { skills } = await listInvocableSkills(session)
    expect(skills.map((s) => s.name)).toContain('house-voice')
  })

  it('does not list an offer the org switched off', async () => {
    vi.mocked(repository.listCuratedSkillActivations).mockResolvedValue([
      activation('oib-fire-check', false),
    ])
    const { skills } = await listInvocableSkills(session)
    expect(skills.map((s) => s.name)).not.toContain('oib-fire-check')
  })

  it('still lists an org row that shadows machinery, because that copy is theirs', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ name: 'data-table-analysis', description: 'org shadow' }),
    ])
    const { skills } = await listInvocableSkills(session)
    expect(skills.find((s) => s.name === 'data-table-analysis')).toMatchObject({
      origin: 'org',
      description: 'org shadow',
    })
  })

  it('never offers a skill scoped away from the chat agent', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ name: 'sandbox-writer', metadata: { 'grid-agents': 'deep_researcher' } }),
    ])
    const { skills } = await listInvocableSkills(session)
    expect(skills.map((s) => s.name)).not.toContain('sandbox-writer')
  })

  it('carries only level-1 metadata — a menu never fetches a body', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([makeSkill({ name: 'a-skill' })])
    const { skills } = await listInvocableSkills(session)
    const entry = skills.find((s) => s.name === 'a-skill')
    expect(entry).toEqual({ name: 'a-skill', description: 'Does the thing.', origin: 'org' })
  })
})

describe('skill categories', () => {
  it('lists platform categories before org categories, with their scope', async () => {
    vi.mocked(categoryRepository.listCategoriesForOrg).mockResolvedValue([
      makeCategory({ id: 'cat-1', name: 'Recherche', slug: 'research', sortOrder: 0 }),
      makeCategory({ id: 'cat-2', organizationId: 'org_1', name: 'Eigene', slug: null, sortOrder: 0 }),
    ])
    const { categories } = await listSkills(session)
    expect(categories.map((c) => c.name)).toEqual(['Recherche', 'Eigene'])
    expect(categories[0]).toMatchObject({ scope: 'platform', slug: 'research' })
    expect(categories[1]).toMatchObject({ scope: 'org' })
  })

  it('categories a builtin file offer by its collection slug', async () => {
    vi.mocked(categoryRepository.listCategoriesForOrg).mockResolvedValue([
      makeCategory({ id: 'cat-1', name: 'Recherche', slug: 'research' }),
    ])
    const { skills } = await listSkills(session)
    expect(skills.find((s) => s.name === 'oib-fire-check')?.categoryId).toBe('cat-1')
  })

  it('keeps a dashboard row on its stored category', async () => {
    publishPlatformRows([platformRow({ categoryId: 'cat-9' })])
    const { skills } = await listSkills(session)
    expect(skills.find((s) => s.name === 'energy-check')?.categoryId).toBe('cat-9')
  })

  it('leaves file offers unsorted when no category carries their slug', async () => {
    const { skills } = await listSkills(session)
    expect(skills.find((s) => s.name === 'oib-fire-check')?.categoryId).toBeNull()
  })

  it('refuses a category outside the org on create', async () => {
    vi.mocked(categoryRepository.findCategoryInScope).mockResolvedValue(null)
    vi.mocked(repository.insertSkill).mockImplementation(async () => makeSkill())
    await expect(
      createSkill(session, { name: 'a', description: 'b', body: 'c', categoryId: 'cat-x' })
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(repository.insertSkill).not.toHaveBeenCalled()
  })

  it('assigns an org or platform category on create', async () => {
    vi.mocked(categoryRepository.findCategoryInScope).mockResolvedValue(
      makeCategory({ id: 'cat-1' })
    )
    vi.mocked(repository.insertSkill).mockImplementation(async (values) => makeSkill(values))
    const { skill } = await createSkill(session, {
      name: 'a',
      description: 'b',
      body: 'c',
      categoryId: 'cat-1',
    })
    expect(skill.categoryId).toBe('cat-1')
  })

  it('removes the category on an explicit null, keeps it on an omitted key', async () => {
    vi.mocked(repository.findSkill).mockResolvedValue(makeSkill({ categoryId: 'cat-1' }))
    vi.mocked(categoryRepository.findCategoryInScope).mockResolvedValue(
      makeCategory({ id: 'cat-2' })
    )
    vi.mocked(repository.updateSkill).mockImplementation(
      async (_id, _org, patch) => makeSkill({ categoryId: patch.categoryId ?? 'cat-1' })
    )
    await updateSkill(session, 'skill-1', { description: 'neu' })
    expect(vi.mocked(repository.updateSkill).mock.calls[0][2]).not.toHaveProperty('categoryId')
    expect(categoryRepository.findCategoryInScope).not.toHaveBeenCalled()
    await updateSkill(session, 'skill-1', { categoryId: 'cat-2' })
    expect(vi.mocked(repository.updateSkill).mock.calls[1][2]).toHaveProperty('categoryId', 'cat-2')
    await updateSkill(session, 'skill-1', { categoryId: null })
    expect(vi.mocked(repository.updateSkill).mock.calls[2][2]).toHaveProperty('categoryId', null)
  })
})

describe('skill category CRUD', () => {
  it('lists categories with their scope', async () => {
    vi.mocked(categoryRepository.listCategoriesForOrg).mockResolvedValue([
      makeCategory({ id: 'cat-1', name: 'Recherche', slug: 'research', sortOrder: 0 }),
      makeCategory({ id: 'cat-2', organizationId: 'org_1', name: 'Eigene', slug: null, sortOrder: 0 }),
    ])
    const { categories } = await listSkillCategories(session)
    expect(categories).toEqual([
      { id: 'cat-1', name: 'Recherche', description: null, slug: 'research', sortOrder: 0, scope: 'platform' },
      { id: 'cat-2', name: 'Eigene', description: null, slug: null, sortOrder: 0, scope: 'org' },
    ])
  })

  it('refuses a duplicate category name in the org', async () => {
    vi.mocked(categoryRepository.findOrgCategoryByName).mockResolvedValue(
      makeCategory({ organizationId: 'org_1', name: 'Eigene' })
    )
    vi.mocked(categoryRepository.insertCategory).mockImplementation(async (values) => ({
      ...makeCategory({ organizationId: 'org_1' }),
      ...values,
    }))
    await expect(createSkillCategory(session, { name: 'Eigene' })).rejects.toBeInstanceOf(
      ConflictError
    )
    expect(categoryRepository.insertCategory).not.toHaveBeenCalled()
  })

  it('creates, renames and removes an org category', async () => {
    vi.mocked(categoryRepository.findOrgCategoryByName).mockResolvedValue(null)
    vi.mocked(categoryRepository.insertCategory).mockImplementation(async (values) => ({
      ...makeCategory({ organizationId: 'org_1' }),
      ...values,
    }))
    const { category } = await createSkillCategory(session, { name: 'Eigene' })
    expect(category).toMatchObject({ name: 'Eigene', scope: 'org' })

    vi.mocked(categoryRepository.findOrgCategory).mockResolvedValue(
      makeCategory({ id: 'cat-9', organizationId: 'org_1', name: 'Eigene' })
    )
    vi.mocked(categoryRepository.updateCategory).mockImplementation(
      async (_id, patch) => ({ ...makeCategory({ id: 'cat-9', organizationId: 'org_1' }), ...patch, description: patch.description ?? null })
    )
    const renamed = await updateSkillCategory(session, 'cat-9', { name: 'Prüfungen' })
    expect(renamed.category.name).toBe('Prüfungen')

    vi.mocked(categoryRepository.deleteCategory).mockResolvedValue(true)
    await expect(deleteSkillCategory(session, 'cat-9')).resolves.toEqual({ deleted: true })
  })

  it('never addresses a platform category from the org path', async () => {
    vi.mocked(categoryRepository.findOrgCategory).mockResolvedValue(null)
    vi.mocked(categoryRepository.deleteCategory).mockResolvedValue(true)
    await expect(deleteSkillCategory(session, 'cat-1')).rejects.toBeInstanceOf(NotFoundError)
    expect(categoryRepository.deleteCategory).not.toHaveBeenCalled()
  })

  it('refuses a create past the list limit instead of silently dropping rows', async () => {
    vi.mocked(categoryRepository.findOrgCategoryByName).mockResolvedValue(null)
    vi.mocked(categoryRepository.listOrgCategories).mockResolvedValue(
      Array.from({ length: 100 }, (_, index) =>
        makeCategory({ id: `cat-${index}`, organizationId: 'org_1', name: `Kat ${index}` })
      )
    )
    vi.mocked(categoryRepository.insertCategory).mockImplementation(async (values) => ({
      ...makeCategory({ organizationId: 'org_1' }),
      ...values,
    }))
    await expect(createSkillCategory(session, { name: 'Eine zu viel' })).rejects.toBeInstanceOf(
      ConflictError
    )
    expect(categoryRepository.insertCategory).not.toHaveBeenCalled()
  })

  it('does not spend an org quota on the platform\u2019s categories', async () => {
    vi.mocked(categoryRepository.findOrgCategoryByName).mockResolvedValue(null)
    vi.mocked(categoryRepository.listCategoriesForOrg).mockResolvedValue(
      Array.from({ length: 100 }, (_, index) =>
        makeCategory({ id: `plat-${index}`, name: `Plattform ${index}` })
      )
    )
    vi.mocked(categoryRepository.listOrgCategories).mockResolvedValue([])
    vi.mocked(categoryRepository.insertCategory).mockImplementation(async (values) => ({
      ...makeCategory({ organizationId: 'org_1' }),
      ...values,
    }))
    const { category } = await createSkillCategory(session, { name: 'Eigene' })
    expect(category).toMatchObject({ name: 'Eigene', scope: 'org' })
  })
})

describe('searchSkills and readSkill: the office’s procedures, read by an agent', () => {
  const STAIRS = makeSkill({
    id: 'skill-stairs',
    name: 'stair-check',
    description: 'Checks stairs against OIB 4.',
    body: '# Stairs\n\nMeasure every riser.\nCompare the riser height with OIB 4, 2.7.\nWrite the result down.',
  })
  const LETTER = makeSkill({ id: 'skill-letter', name: 'client-letter', description: 'Writes a letter to the client.', body: 'Be brief.' })

  beforeEach(() => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([STAIRS, LETTER, makeSkill({ id: 'off', name: 'old-way', enabled: false })])
  })

  it('ranks by the words of a task and shows the body lines that hold them, numbered', async () => {
    const { skills, total } = await searchSkills(session, 'riser height', 10)
    expect(total).toBe(1)
    expect(skills[0]).toEqual({
      name: 'stair-check',
      description: 'Checks stairs against OIB 4.',
      origin: 'org',
      lines: [
        { line: 3, text: 'Measure every riser.' },
        { line: 4, text: 'Compare the riser height with OIB 4, 2.7.' },
      ],
    })
  })

  it('ranks a name hit above a body hit', async () => {
    vi.mocked(repository.listSkillsInOrg).mockResolvedValue([
      makeSkill({ id: 'a', name: 'site-visit', description: 'Prepares a visit.', body: 'Bring the letter.' }),
      LETTER,
    ])
    const { skills } = await searchSkills(session, 'letter', 10)
    expect(skills.map((s) => s.name)).toEqual(['client-letter', 'site-visit'])
  })

  it('lists every enabled skill for an empty query, never a disabled one or the machinery, within the limit', async () => {
    const all = await searchSkills(session, '', 10)
    expect(all.skills.map((s) => s.name)).toEqual(['client-letter', 'oib-fire-check', 'stair-check'])
    expect(all.skills.every((s) => s.lines.length === 0)).toBe(true)
    expect((await searchSkills(session, '', 1)).skills).toHaveLength(1)
  })

  it('reads one skill by name, with its body, regardless of case', async () => {
    const { skill } = await readSkill(session, ' Stair-Check ')
    expect(skill).toEqual({ name: 'stair-check', description: 'Checks stairs against OIB 4.', origin: 'org', body: STAIRS.body })
  })

  it('answers 404 for a disabled skill, the machinery or an unknown name', async () => {
    await expect(readSkill(session, 'old-way')).rejects.toBeInstanceOf(NotFoundError)
    await expect(readSkill(session, 'data-table-analysis')).rejects.toBeInstanceOf(NotFoundError)
    await expect(readSkill(session, 'nope')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('is gated on the skills feature', async () => {
    vi.mocked(requireSkillsEnabled).mockReturnValue({ status: 403 } as Response)
    await expect(searchSkills(session, '', 10)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(readSkill(session, 'stair-check')).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// @disk-inputs: ../../tests/fixtures/skills_resolve/resolve_payload.json
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import * as repository from './repository'
import * as platformRepository from './platform-repository'
import { findPlatformSkill, listPlatformSkills } from './platform-skills'
import { resolveSkillsForAgent } from './service'
import type { Skill } from '@/lib/db/schema/jobs'
import type { PlatformSkillRow } from '@/lib/db/schema/platform-skills'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolvePath(HERE, '../../../../tests/fixtures/skills_resolve/resolve_payload.json')
const SAMPLE = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as Array<Record<string, unknown>>

const AGENT = 'researcher'
const ORG = 'org_1'

const VOICE_ROW: PlatformSkillRow = {
  id: 'ps-voice',
  categoryId: null,
  name: 'piloti-voice',
  description: 'Schreibt jede Antwort in der Hausstimme.',
  body: 'Kein Vorbehalt vor der Aussage.',
  metadata: {
    'grid-title': 'Piloti-Stimme',
    'grid-hidden': 'true',
    'grid-cards': 'legal_basis,calculation',
  },
  published: true,
  delivery: 'offer',
  createdBy: 'owner',
  createdByEmail: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

const OFFER_ROW: PlatformSkillRow = {
  ...VOICE_ROW,
  id: 'ps-offer',
  name: 'oib-fire-check',
  description: 'Prüft das Projekt gegen den OIB-Brandschutz.',
  body: 'Handle als Brandschutzprüfer.',
  metadata: { 'grid-catalog': 'curated' },
}

const MACHINERY = {
  name: 'data-table-analysis',
  description: 'Analysiert Tabellen deterministisch.',
  body: '# Data Table Analysis\n\nRechne deterministisch.',
  metadata: {},
  origin: 'platform' as const,
  collection: 'research' as const,
}

const ORG_ROW: Skill = {
  id: 'skill-1',
  categoryId: null,
  organizationId: ORG,
  name: 'buero-detailpruefung',
  description: 'Prüft ein Detail gegen die Büroregeln.',
  body: 'Vergleiche das Detail mit dem Regeldetail.',
  metadata: { 'grid-agents': AGENT },
  origin: 'org',
  clonedFrom: null,
  enabled: true,
  createdBy: 'user_1',
  createdByEmail: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

beforeEach(() => {
  vi.mocked(listPlatformSkills).mockReturnValue([MACHINERY])
  vi.mocked(findPlatformSkill).mockImplementation(
    (name) => [MACHINERY].find((skill) => skill.name === name) ?? null
  )
  vi.mocked(platformRepository.listPublishedOfferRows).mockResolvedValue([OFFER_ROW, VOICE_ROW])
  vi.mocked(repository.listSkillsInOrg).mockResolvedValue([ORG_ROW])
  vi.mocked(repository.listCuratedSkillActivations).mockResolvedValue(
    [OFFER_ROW.name, VOICE_ROW.name].map((skillName) => ({
      organizationId: ORG,
      skillName,
      enabled: true,
      updatedBy: 'user_1',
      updatedByEmail: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }))
  )
})

const served = async (): Promise<Map<string, Record<string, unknown>>> => {
  const { skills } = await resolveSkillsForAgent(ORG, AGENT)
  return new Map(skills.map((skill) => [skill.name, skill as unknown as Record<string, unknown>]))
}

describe('the resolve payload the backend reads', () => {
  it('is still what this service emits, row for row', async () => {
    const live = await served()
    expect([...live.keys()].sort()).toEqual(SAMPLE.map((row) => row.name as string).sort())
    for (const sampled of SAMPLE) {
      const row = live.get(sampled.name as string)
      expect(row, sampled.name as string).toBeDefined()
      expect(row, sampled.name as string).toMatchObject(sampled)
    }
  })

  it('marks no row as fleet policy, because there is no such tier', async () => {
    const live = await served()
    for (const row of live.values()) {
      expect(Object.keys(row)).not.toContain('standard')
    }
  })

  it('carries the reserved metadata verbatim rather than an empty object', async () => {
    const live = await served()
    expect(live.get('piloti-voice')?.metadata).toEqual({
      'grid-title': 'Piloti-Stimme',
      'grid-hidden': 'true',
      'grid-cards': 'legal_basis,calculation',
    })
  })

  it('carries a body, because a description alone cannot shape an answer', async () => {
    const live = await served()
    expect(live.get('piloti-voice')?.body).toBe(VOICE_ROW.body)
  })
})

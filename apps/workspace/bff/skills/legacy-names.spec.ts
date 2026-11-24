/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as agent from '@/shared/vocabularies.generated'
import * as agentLegacyBrand from './legacy-brand-names.generated'
import {
  LEGACY_METADATA_KEYS,
  LEGACY_PLATFORM_SKILL_NAMES,
  LEGACY_SKILL_NAMES,
  canonicalSkillName,
  findSkillNamed,
  legacyNamesOf,
  readMetadata,
  skillNameFamily,
  writtenMetadataKey,
} from './legacy-names'
import { PLATFORM_SKILLS } from './platform-skills'

describe('builtin skill names written before the English names', () => {
  it('maps every old name to a builtin skill that ships and never to itself', () => {
    const shipped = new Set(PLATFORM_SKILLS.map((skill) => skill.name))
    for (const [legacy, current] of Object.entries(LEGACY_SKILL_NAMES)) {
      expect(shipped.has(current), current).toBe(true)
      expect(shipped.has(legacy), `${legacy} must not ship beside its replacement`).toBe(false)
      expect(canonicalSkillName(legacy)).toBe(current)
    }
    expect(canonicalSkillName('hygiene')).toBe('hygiene')
    expect(canonicalSkillName('an-org-skill')).toBe('an-org-skill')
  })

  it('lists the old names of a skill for the slash menu', () => {
    expect(legacyNamesOf('submission-check')).toEqual(['einreichcheck'])
    expect(legacyNamesOf('hygiene')).toEqual([])
  })

  it('names one skill by its current name and every old one, from either spelling', () => {
    const [legacy, current] = Object.entries(LEGACY_PLATFORM_SKILL_NAMES)[0]!
    expect(skillNameFamily(current)).toEqual([current, legacy])
    expect(skillNameFamily(legacy)).toEqual([current, legacy])
    expect(skillNameFamily('hygiene')).toEqual(['hygiene'])
  })

  it('is the table the Python agent resolves with', () => {
    expect(LEGACY_SKILL_NAMES).toEqual(agent.LEGACY_SKILL_NAMES)
    expect(LEGACY_PLATFORM_SKILL_NAMES).toEqual(agentLegacyBrand.LEGACY_PLATFORM_SKILL_NAMES)
    expect(LEGACY_METADATA_KEYS).toEqual(agentLegacyBrand.LEGACY_METADATA_KEYS)
  })
})

describe('house skills stored under their old names', () => {
  it('answers to the old and the new name, and each resolves to the other', () => {
    for (const [legacy, current] of Object.entries(LEGACY_PLATFORM_SKILL_NAMES)) {
      expect(canonicalSkillName(legacy)).toBe(current)
      expect(legacyNamesOf(current)).toEqual([legacy])
    }
  })

  it('finds a stored row under either name, the exact name first', () => {
    const [[legacy, current]] = Object.entries(LEGACY_PLATFORM_SKILL_NAMES)
    expect(findSkillNamed([{ name: legacy, id: 'old' }], current)?.id).toBe('old')
    expect(findSkillNamed([{ name: legacy, id: 'old' }], legacy)?.id).toBe('old')
    expect(findSkillNamed([{ name: current, id: 'new' }], legacy)?.id).toBe('new')
    const both = [
      { name: legacy, id: 'old' },
      { name: current, id: 'new' },
    ]
    expect(findSkillNamed(both, current)?.id).toBe('new')
    expect(findSkillNamed(both, legacy)?.id).toBe('old')
    expect(findSkillNamed([{ name: legacy, id: 'old' }], 'hygiene')).toBeUndefined()
  })
})

describe('metadata keys: readers take the new key and the old one, new winning', () => {
  const { agents: stored } = LEGACY_METADATA_KEYS

  it('reads a key from its new spelling, its old spelling, or prefers the new one', () => {
    expect(readMetadata({ agents: 'researcher' }, 'agents')).toBe('researcher')
    expect(readMetadata({ [stored]: 'deep_researcher' }, 'agents')).toBe('deep_researcher')
    expect(readMetadata({ agents: 'researcher', [stored]: 'deep_researcher' }, 'agents')).toBe('researcher')
    expect(readMetadata({}, 'agents')).toBeUndefined()
  })

  it('writes the stored spelling, so an older reader still understands the row', () => {
    expect(writtenMetadataKey('agents')).toBe(stored)
    expect(writtenMetadataKey('auto-invoke')).toBe(LEGACY_METADATA_KEYS['auto-invoke'])
  })
})

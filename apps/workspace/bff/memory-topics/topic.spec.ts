/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { BadRequestError } from '@/lib/api/errors'
import {
  MEMORY_TOPIC_MAX_LENGTH,
  memoryTopicQueryField,
  memoryTopicRenameSchema,
  normalizeTopic,
  pageOfTopic,
  resolveTopic,
  summarizeTopics,
} from './topic'

describe('normalizeTopic', () => {
  it('trims the text and collapses every run of whitespace to one space', () => {
    expect(normalizeTopic('  Brand  schutz\t\nAnlage  ')).toBe('Brand schutz Anlage')
  })

  it('reads an empty, blank or absent topic as no topic', () => {
    expect(normalizeTopic('')).toBeNull()
    expect(normalizeTopic('   \n ')).toBeNull()
    expect(normalizeTopic(null)).toBeNull()
    expect(normalizeTopic(undefined)).toBeNull()
  })

  it('composes a decomposed umlaut, so both spellings are one topic', () => {
    const decomposed = 'Stellplätze'
    expect(normalizeTopic(decomposed)).toBe('Stellplätze')
  })

  it('keeps the case the person typed: folding is for matching, not for storing', () => {
    expect(normalizeTopic('Bauherr')).toBe('Bauherr')
  })

  it('accepts a topic of exactly the maximum length, counted in characters', () => {
    const forty = 'ä'.repeat(MEMORY_TOPIC_MAX_LENGTH)
    expect(normalizeTopic(forty)).toBe(forty)
  })

  it('refuses a topic longer than the maximum, once its spaces are collapsed', () => {
    expect(() => normalizeTopic('x'.repeat(MEMORY_TOPIC_MAX_LENGTH + 1))).toThrow(BadRequestError)
    // Spaces that collapse do not count against the bound.
    expect(normalizeTopic(`${'a'.repeat(30)}${' '.repeat(20)}${'b'.repeat(9)}`)).toBe(`${'a'.repeat(30)} ${'b'.repeat(9)}`)
  })

  it('refuses a value that is not text', () => {
    expect(() => normalizeTopic(42)).toThrow(BadRequestError)
    expect(() => normalizeTopic({ topic: 'Brandschutz' })).toThrow(BadRequestError)
  })
})

describe('resolveTopic', () => {
  const shelf = ['Brandschutz', 'Stellplätze', 'Bauherr']

  it('reuses the spelling the shelf already has, whatever the case', () => {
    expect(resolveTopic('brandschutz', shelf)).toBe('Brandschutz')
    expect(resolveTopic('  STELLPLÄTZE ', shelf)).toBe('Stellplätze')
  })

  it('folds with the German rules: Ä and ä are one letter', () => {
    expect(resolveTopic('stellplätze', ['Stellplätze'])).toBe('Stellplätze')
    expect(resolveTopic('ÄUßERES', ['äußeres'])).toBe('äußeres')
  })

  it('prefers the exact spelling when two spellings of one topic are on the shelf', () => {
    expect(resolveTopic('brandschutz', ['Brandschutz', 'brandschutz'])).toBe('brandschutz')
  })

  it('stores a new topic in its normalized spelling when the shelf has none like it', () => {
    expect(resolveTopic('  Fluchtwege  ', shelf)).toBe('Fluchtwege')
  })

  it('answers null for no topic, whatever the shelf holds', () => {
    expect(resolveTopic(null, shelf)).toBeNull()
    expect(resolveTopic('   ', shelf)).toBeNull()
  })
})

describe('summarizeTopics', () => {
  it('counts each topic on the notes that have one, most notes first, then by name', () => {
    const summary = summarizeTopics([
      { topic: 'Stellplätze' },
      { topic: 'Brandschutz' },
      { topic: null },
      { topic: 'Brandschutz' },
      { topic: 'Bauherr' },
      { topic: 'Stellplätze' },
      { topic: 'Brandschutz' },
    ])
    expect(summary).toEqual([
      { name: 'Brandschutz', count: 3 },
      { name: 'Stellplätze', count: 2 },
      { name: 'Bauherr', count: 1 },
    ])
  })

  it('answers an empty list for a shelf with no topic at all', () => {
    expect(summarizeTopics([])).toEqual([])
    expect(summarizeTopics([{ topic: null }])).toEqual([])
  })

  it('breaks a tie in count by name in German order', () => {
    expect(summarizeTopics([{ topic: 'Zufahrt' }, { topic: 'Äußeres' }])).toEqual([
      { name: 'Äußeres', count: 1 },
      { name: 'Zufahrt', count: 1 },
    ])
  })
})

describe('memoryTopicRenameSchema', () => {
  it('takes a rename, a merge and an ungrouping, and refuses a missing field', () => {
    expect(memoryTopicRenameSchema.safeParse({ from: 'Brandschutz', to: 'Feuerschutz' }).success).toBe(true)
    expect(memoryTopicRenameSchema.safeParse({ from: null, to: 'Bauherr' }).success).toBe(true)
    expect(memoryTopicRenameSchema.safeParse({ from: 'Bauherr', to: null }).success).toBe(true)
    expect(memoryTopicRenameSchema.safeParse({ from: 'Bauherr' }).success).toBe(false)
  })
})

describe('memoryTopicQueryField', () => {
  it('takes a topic name, an empty value for the notes with no topic, and nothing at all', () => {
    expect(memoryTopicQueryField.safeParse('Brandschutz').success).toBe(true)
    expect(memoryTopicQueryField.safeParse('').success).toBe(true)
    expect(memoryTopicQueryField.safeParse(undefined).success).toBe(true)
  })
})

describe('pageOfTopic', () => {
  const items = [
    { id: 'a', topic: 'Brandschutz' },
    { id: 'b', topic: null },
    { id: 'c', topic: 'Stellplätze' },
    { id: 'd', topic: 'Brandschutz' },
    { id: 'e', topic: 'Brandschutz' },
  ]

  it('keeps the items of one topic in the order given, whatever the case of the name', () => {
    const page = pageOfTopic(items, 'BRANDSCHUTZ', { limit: 10, offset: 0 })
    expect(page.items.map((item) => item.id)).toEqual(['a', 'd', 'e'])
    expect(page.nextCursor).toBeNull()
  })

  it('reads the empty value as the items with no topic', () => {
    expect(pageOfTopic(items, '', { limit: 10, offset: 0 }).items.map((item) => item.id)).toEqual(['b'])
  })

  it('pages the filtered list, not the whole one, and says where the next page starts', () => {
    const first = pageOfTopic(items, 'Brandschutz', { limit: 2, offset: 0 })
    expect(first.items.map((item) => item.id)).toEqual(['a', 'd'])
    expect(first.nextCursor).toBe('2')
    const second = pageOfTopic(items, 'Brandschutz', { limit: 2, offset: 2 })
    expect(second.items.map((item) => item.id)).toEqual(['e'])
    expect(second.nextCursor).toBeNull()
  })

  it('selects nothing for a topic no visible item holds', () => {
    expect(pageOfTopic(items, 'Bauherr', { limit: 10, offset: 0 })).toEqual({ items: [], nextCursor: null })
  })
})

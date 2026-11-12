/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { DIGEST_TOPIC_INDEX_MAX, formatTopicDigest, topicIndexLine } from './memory-digest'
import type { DigestItem } from './memory-service'

const note = (overrides: Partial<DigestItem> = {}): DigestItem => ({
  scope: 'project',
  kind: 'derived_fact',
  content: 'the roof load is 2 kN/m2',
  confidence: 'medium',
  verification: 'unverified',
  topic: null,
  ...overrides,
})

const HEADER_LINE = 'PROJECT_MEMORY v1'
const BUDGET = 1800

describe('formatTopicDigest', () => {
  it('returns null when no note prints', () => {
    expect(formatTopicDigest([], 0, BUDGET)).toBeNull()
    expect(formatTopicDigest([note({ content: '  \n ' })], 0, BUDGET)).toBeNull()
  })

  it('opens with the topic index right after the header, then one line per note with its topic first', () => {
    const digest = formatTopicDigest(
      [
        note({ content: 'EI 90 im Treppenhaus', topic: 'Brandschutz' }),
        note({ content: 'Stellplatzschlüssel 1 je Wohnung', kind: 'preference', topic: 'Stellplätze' }),
      ],
      0,
      BUDGET
    )

    expect(digest).toBe(
      [
        HEADER_LINE,
        'Themen im Projektgedächtnis (höchstens 20): Brandschutz (1), Stellplätze (1)',
        '- [Brandschutz | derived_fact | medium | unverified] "EI 90 im Treppenhaus"',
        '- [Stellplätze | preference | medium | unverified] "Stellplatzschlüssel 1 je Wohnung"',
      ].join('\n')
    )
  })

  it('keeps a note without a topic as before: no topic tag, and no name in the index', () => {
    const digest = formatTopicDigest([note({ content: 'roof load', topic: null })], 0, BUDGET)

    expect(digest).toBe([HEADER_LINE, '- [derived_fact | medium | unverified] "roof load"'].join('\n'))
  })

  it('puts the topic before the org-wide and restricted tags', () => {
    const digest = formatTopicDigest(
      [
        note({
          scope: 'organization',
          kind: 'preference',
          confidence: 'high',
          verification: 'user_confirmed',
          content: 'prefer metric units',
          topic: 'Einheiten',
        }),
        note({ content: 'Honorar pauschal', topic: 'Honorar', restrictedFolderIds: ['f-1'] }),
      ],
      0,
      BUDGET
    )

    expect(digest?.split('\n').slice(2)).toEqual([
      '- [Einheiten | org-wide | preference | high | user_confirmed] "prefer metric units"',
      '- [Honorar | restricted | derived_fact | medium | unverified] "Honorar pauschal"',
    ])
  })

  it('cleans brackets, bars and quotes out of a topic so it cannot close its tag or forge a line', () => {
    const digest = formatTopicDigest([note({ topic: 'Bau] "x | y' })], 0, BUDGET)
    const lines = (digest as string).split('\n')

    expect(lines[1]).toBe('Themen im Projektgedächtnis (höchstens 20): Bau x y (1)')
    expect(lines[2]).toBe('- [Bau x y | derived_fact | medium | unverified] "the roof load is 2 kN/m2"')
    for (const line of lines.slice(2)) {
      expect(line).toMatch(/^- \[[^\]]+\] ".*"$/)
    }
  })

  it('counts the printed notes per topic, most notes first, then by name', () => {
    const digest = formatTopicDigest(
      [
        note({ content: 'a', topic: 'Stellplätze' }),
        note({ content: 'b', topic: 'Brandschutz' }),
        note({ content: 'c', topic: 'Brandschutz' }),
        note({ content: 'd', topic: 'Bauherr' }),
      ],
      0,
      BUDGET
    )

    expect((digest as string).split('\n')[1]).toBe(
      'Themen im Projektgedächtnis (höchstens 20): Brandschutz (2), Bauherr (1), Stellplätze (1)'
    )
  })

  it('names at most twenty topics and says how many it left out', () => {
    const items = Array.from({ length: DIGEST_TOPIC_INDEX_MAX + 2 }, (_, index) =>
      note({ content: `note ${index}`, topic: `Thema ${String(index).padStart(2, '0')}` })
    )
    const index = (formatTopicDigest(items, 0, BUDGET) as string).split('\n')[1]

    expect(index.startsWith('Themen im Projektgedächtnis (höchstens 20): ')).toBe(true)
    expect(index.endsWith(', … (+2 weitere)')).toBe(true)
    expect(index.split(' (1)').length - 1).toBe(DIGEST_TOPIC_INDEX_MAX)
  })

  it('does not name a topic whose note the budget left out', () => {
    const long = 'x'.repeat(1700)
    const digest = formatTopicDigest(
      [note({ content: long, topic: 'Brandschutz' }), note({ content: 'roof load', topic: 'Geheim' })],
      0,
      BUDGET
    ) as string

    expect(digest).not.toContain('Geheim')
    expect(digest.split('\n')[1]).toBe('Themen im Projektgedächtnis (höchstens 20): Brandschutz (1)')
  })

  it('counts the index against the budget, and stays within it', () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      note({ content: `note ${index} ${'y'.repeat(90)}`, topic: `Thema ${index} ${'z'.repeat(20)}` })
    )
    const digest = formatTopicDigest(items, 0, BUDGET) as string

    expect(digest.length).toBeLessThanOrEqual(BUDGET)
    const printedLines = digest.split('\n').filter((line) => line.startsWith('- ['))
    const index = digest.split('\n')[1]
    // Every printed note is named in the index, and no note past the cut is.
    expect(printedLines.length).toBeGreaterThan(0)
    expect(printedLines.length).toBeLessThan(items.length)
    for (const line of printedLines) {
      const topic = line.slice(3, line.indexOf(' | '))
      expect(index).toContain(topic)
    }
  })

  it('appends the omitted-notes notice after the lines', () => {
    const digest = formatTopicDigest([note({ content: 'roof load', topic: 'Dach' })], 3, BUDGET)

    expect(digest?.split('\n').slice(-1)[0]).toMatch(/^\(\+3 weitere Notizen/)
  })
})

describe('topicIndexLine', () => {
  it('is null when no note has a topic', () => {
    expect(topicIndexLine([note(), note({ topic: '   ' })])).toBeNull()
  })
})

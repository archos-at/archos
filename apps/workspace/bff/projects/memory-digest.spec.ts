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
const INDEX_HEAD = "topics of the project's memory, bounded (at most 20 named):"
const BUDGET = 1800

describe('formatTopicDigest', () => {
  it('returns null when no note prints', () => {
    expect(formatTopicDigest([], 0, BUDGET)).toBeNull()
    expect(formatTopicDigest([note({ content: '  \n ' })], 0, BUDGET)).toBeNull()
  })

  it('opens with the topic index right after the header, then one line per note with its quoted topic first', () => {
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
        `${INDEX_HEAD} "Brandschutz" (1), "Stellplätze" (1)`,
        '- ["Brandschutz" | derived_fact | medium | unverified] "EI 90 im Treppenhaus"',
        '- ["Stellplätze" | preference | medium | unverified] "Stellplatzschlüssel 1 je Wohnung"',
      ].join('\n')
    )
  })

  it('keeps a shelf with no topic byte-identical: no index, no topic tag', () => {
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
      '- ["Einheiten" | org-wide | preference | high | user_confirmed] "prefer metric units"',
      '- ["Honorar" | restricted | derived_fact | medium | unverified] "Honorar pauschal"',
    ])
  })

  it('cleans brackets and bars out of a topic and escapes its quotes, so it cannot close its tag or forge a line', () => {
    const digest = formatTopicDigest([note({ topic: 'Bau] "x | y' })], 0, BUDGET)
    const lines = (digest as string).split('\n')

    expect(lines[1]).toBe(`${INDEX_HEAD} "Bau \\"x y" (1)`)
    expect(lines[2]).toBe(
      '- ["Bau \\"x y" | derived_fact | medium | unverified] "the roof load is 2 kN/m2"'
    )
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
      `${INDEX_HEAD} "Brandschutz" (2), "Bauherr" (1), "Stellplätze" (1)`
    )
  })

  it('names at most twenty topics and says how many it left out', () => {
    const items = Array.from({ length: DIGEST_TOPIC_INDEX_MAX + 2 }, (_, index) =>
      note({ content: `note ${index}`, topic: `T${String(index).padStart(2, '0')}` })
    )
    const index = (formatTopicDigest(items, 0, BUDGET) as string).split('\n')[1]

    expect(index.startsWith(INDEX_HEAD)).toBe(true)
    expect(index.endsWith(', (+2 more topics, not named)')).toBe(true)
    expect(index.split(' (1)').length - 1).toBe(DIGEST_TOPIC_INDEX_MAX)
  })

  it('does not name a topic whose note the budget left out', () => {
    // One long note fills the budget. The second note fits beside it only if the
    // index is left out, so the index must be written from the note that printed.
    const long = 'x'.repeat(1600)
    const digest = formatTopicDigest(
      [note({ content: long, topic: 'Brandschutz' }), note({ content: 'roof load', topic: 'Geheim' })],
      0,
      BUDGET
    ) as string

    expect(digest).not.toContain('Geheim')
    expect(digest.split('\n')[1]).toBe(`${INDEX_HEAD} "Brandschutz" (1)`)
    expect(digest.length).toBeLessThanOrEqual(BUDGET)
  })

  it('counts the index against the budget, and stays within it', () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      note({ content: `note ${index} ${'y'.repeat(90)}`, topic: `Thema ${index} ${'z'.repeat(20)}` })
    )
    const digest = formatTopicDigest(items, 0, BUDGET) as string

    expect(digest.length).toBeLessThanOrEqual(BUDGET)
    const lines = digest.split('\n')
    const printedLines = lines.filter((line) => line.startsWith('- ['))
    expect(printedLines.length).toBeGreaterThan(0)
    expect(printedLines.length).toBeLessThan(items.length)
    // The index is bounded: it names some topics and counts the rest in its tail.
    const index = lines[1]
    const named = [...index.matchAll(/"([^"]*)" \(\d+\)/g)].map((match) => match[1])
    const tail = /\(\+(\d+) more topics, not named\)/.exec(index)
    // Without the shelf's topics the index is over the printed notes, so every printed topic
    // is either named or among the topics the tail counts (the tail counts all unnamed topics).
    // A printed line opens `- ["Topic" | `, so the topic runs from index 4 to its closing quote.
    const printedTopics = new Set(printedLines.map((line) => line.slice(4, line.indexOf('" | '))))
    const unnamed = [...printedTopics].filter((topic) => !named.includes(topic))
    if (unnamed.length > 0) expect(tail?.[1]).toBe(String(unnamed.length))
  })

  it('appends the omitted-notes notice after the lines', () => {
    const digest = formatTopicDigest([note({ content: 'roof load', topic: 'Dach' })], 3, BUDGET)

    expect(digest?.split('\n').slice(-1)[0]).toMatch(/^\(\+3 weitere Notizen/)
  })
})

describe("formatTopicDigest with the shelf's open topics", () => {
  it('names an open topic of the shelf even when none of its notes prints', () => {
    const digest = formatTopicDigest(
      [note({ content: 'EI 90 im Treppenhaus', topic: 'Brandschutz' })],
      0,
      BUDGET,
      [
        { name: 'Stellplätze', count: 3 },
        { name: 'Brandschutz', count: 2 },
      ]
    ) as string

    expect(digest.split('\n')[1]).toBe(`${INDEX_HEAD} "Stellplätze" (3), "Brandschutz" (2)`)
    expect(digest.split('\n')).toHaveLength(3)
  })

  it('adds an admitted restricted note to its topic once, beside the open topics', () => {
    const digest = formatTopicDigest(
      [note({ content: 'Honorar pauschal', topic: 'Honorar', restrictedFolderIds: ['f-1'] })],
      0,
      BUDGET,
      [{ name: 'Brandschutz', count: 2 }]
    ) as string

    expect(digest.split('\n')[1]).toBe(`${INDEX_HEAD} "Brandschutz" (2), "Honorar" (1)`)
  })

  it('names no topic of a restricted note the caller did not pass (not admitted)', () => {
    // The caller leaves a restricted note out of `items` when its folders are not admitted, so its
    // topic can reach the index only through the shelf's OPEN topics, which never hold a restricted topic.
    const digest = formatTopicDigest([note({ content: 'Dach in Holz', topic: 'Dach' })], 1, BUDGET, [
      { name: 'Dach', count: 1 },
      { name: 'Brandschutz', count: 2 },
    ]) as string

    expect(digest.split('\n')[1]).toBe(`${INDEX_HEAD} "Brandschutz" (2), "Dach" (1)`)
    expect(digest).not.toContain('Geheim')
  })

  it('names at most twenty shelf topics and counts the rest in the tail', () => {
    const shelf = Array.from({ length: DIGEST_TOPIC_INDEX_MAX + 5 }, (_, index) => ({
      name: `T${String(index).padStart(2, '0')}`,
      count: 1,
    }))
    const digest = formatTopicDigest([note({ topic: 'T00' })], 0, BUDGET, shelf) as string
    const index = digest.split('\n')[1]

    expect(index.endsWith(', (+5 more topics, not named)')).toBe(true)
    expect(index.split(' (1)').length - 1).toBe(DIGEST_TOPIC_INDEX_MAX)
    expect(digest.length).toBeLessThanOrEqual(BUDGET)
  })

  it('keeps a shelf with no topic at all byte-identical: no index, no topic tag', () => {
    const digest = formatTopicDigest([note({ content: 'roof load', topic: null })], 0, BUDGET, [])

    expect(digest).toBe([HEADER_LINE, '- [derived_fact | medium | unverified] "roof load"'].join('\n'))
  })
})

describe('topicIndexLine', () => {
  it('is null when no note has a topic', () => {
    expect(topicIndexLine([note(), note({ topic: '   ' })])).toBeNull()
  })
})

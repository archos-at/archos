/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import {
  PERSONAL_DIGEST_INDEX_MAX_CHARS,
  PERSONAL_DIGEST_MAX_CHARS,
  PERSONAL_DIGEST_MAX_TOPICS,
  renderPersonalMemoryDigest,
  topicIndexLine,
  type PersonalDigestNote,
} from './digest'

const HEADER = 'PERSONAL_MEMORY v1'

function note(overrides: Partial<PersonalDigestNote> = {}): PersonalDigestNote {
  return { kind: 'preference', pinned: false, content: 'Answers in short paragraphs.', topic: null, ...overrides }
}

describe('renderPersonalMemoryDigest without topics', () => {
  it('is null when the shelf holds no note', () => {
    expect(renderPersonalMemoryDigest([], { topics: [], total: 0 })).toBeNull()
  })

  it('renders the block as it did before topics: one line per note, no index, no headings', () => {
    const digest = renderPersonalMemoryDigest(
      [note({ kind: 'profile', pinned: true, content: 'Leads the fire-safety reviews.' }), note({ content: 'Says "kurz".' })],
      { topics: [], total: 2 }
    )

    expect(digest).toBe(
      [HEADER, '- [pinned | profile] "Leads the fire-safety reviews."', '- [preference] "Says \\"kurz\\"."'].join('\n')
    )
  })
})

describe('renderPersonalMemoryDigest with topics', () => {
  it('opens with the index, then one group per topic in the order of their first note', () => {
    const digest = renderPersonalMemoryDigest(
      [
        note({ kind: 'profile', pinned: true, content: 'Leads the fire-safety reviews.', topic: 'Brandschutz' }),
        note({ content: 'Wants short paragraphs.', topic: 'Stellplätze' }),
        note({ content: 'Answers in German.', topic: 'Brandschutz' }),
      ],
      {
        topics: [
          { name: 'Brandschutz', count: 2 },
          { name: 'Stellplätze', count: 1 },
        ],
        total: 3,
      }
    )

    expect(digest).toBe(
      [
        HEADER,
        `topics of the person's 3 notes (at most ${PERSONAL_DIGEST_MAX_TOPICS} named): "Brandschutz" (2), "Stellplätze" (1)`,
        'Topic "Brandschutz":',
        '- [pinned | profile] "Leads the fire-safety reviews."',
        '- [preference] "Answers in German."',
        'Topic "Stellplätze":',
        '- [preference] "Wants short paragraphs."',
      ].join('\n')
    )
  })

  it('puts the notes with no topic last, under their own heading', () => {
    const digest = renderPersonalMemoryDigest(
      [note({ content: 'Note A.', topic: null }), note({ content: 'Note B.', topic: 'X' })],
      { topics: [{ name: 'X', count: 1 }], total: 2 }
    )

    expect(digest).toBe(
      [
        HEADER,
        `topics of the person's 2 notes (at most ${PERSONAL_DIGEST_MAX_TOPICS} named): "X" (1)`,
        'Topic "X":',
        '- [preference] "Note B."',
        'No topic:',
        '- [preference] "Note A."',
      ].join('\n')
    )
  })

  it('quotes a topic name and a note the way the digest quotes text, so neither forges a heading', () => {
    const digest = renderPersonalMemoryDigest([note({ content: 'He said "x".', topic: 'Say "hi"' })], {
      topics: [{ name: 'Say "hi"', count: 1 }],
      total: 1,
    })

    expect(digest).toContain('"Say \\"hi\\"" (1)')
    expect(digest).toContain('Topic "Say \\"hi\\"":')
    expect(digest).toContain('- [preference] "He said \\"x\\"."')
  })

  it('says how many topics the index leaves unnamed, at most twenty named', () => {
    const topics = Array.from({ length: PERSONAL_DIGEST_MAX_TOPICS + 2 }, (_, index) => ({
      name: `T${String(index + 1).padStart(2, '0')}`,
      count: 1,
    }))

    const line = topicIndexLine({ topics, total: topics.length })

    expect(line).toContain(`"T${String(PERSONAL_DIGEST_MAX_TOPICS).padStart(2, '0')}" (1)`)
    expect(line).not.toContain('"T21"')
    expect(line).toContain('(+2 more topics, not named)')
  })

  it('bounds the index in characters as well, so long topic names cannot take the notes’ room', () => {
    const topics = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((letter) => ({ name: letter.repeat(40), count: 1 }))

    const line = topicIndexLine({ topics, total: 7 }) as string

    expect(line.length).toBeLessThanOrEqual(PERSONAL_DIGEST_INDEX_MAX_CHARS + 30)
    expect(line).toContain('more topics, not named')
  })

  it('stays within the budget, footer included, and counts every note the block leaves out', () => {
    const notes = Array.from({ length: 8 }, (_, index) =>
      note({ content: `${index} ${'x'.repeat(300)}`, topic: index % 2 === 0 ? 'Brandschutz' : 'Stellplätze' })
    )

    const digest = renderPersonalMemoryDigest(notes, {
      topics: [
        { name: 'Brandschutz', count: 4 },
        { name: 'Stellplätze', count: 4 },
      ],
      total: 8,
    }) as string
    const kept = digest.split('\n').filter((line) => line.startsWith('- [')).length

    expect(digest.length).toBeLessThanOrEqual(PERSONAL_DIGEST_MAX_CHARS)
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThan(8)
    expect(digest.endsWith(`(+${8 - kept} more personal notes, not shown.)`)).toBe(true)
  })

  it('ends the block at the first group that loses a note, so later groups are not shown half-way', () => {
    const long = (index: number) => note({ content: `${index} ${'x'.repeat(500)}`, topic: 'A' })
    const digest = renderPersonalMemoryDigest(
      [long(1), long(2), long(3), note({ content: 'Short.', topic: 'B' })],
      {
        topics: [
          { name: 'A', count: 3 },
          { name: 'B', count: 1 },
        ],
        total: 4,
      }
    ) as string

    expect(digest).toContain('Topic "A":')
    expect(digest).not.toContain('Topic "B":')
    expect(digest).not.toContain('Short.')
    expect(digest.endsWith('(+2 more personal notes, not shown.)')).toBe(true)
  })

  it('still says the shelf holds notes when not even the first one fits', () => {
    const digest = renderPersonalMemoryDigest([note({ content: 'y'.repeat(2000), topic: 'A' })], {
      topics: [{ name: 'A', count: 2 }],
      total: 2,
    })

    expect(digest).toContain(HEADER)
    expect(digest?.endsWith('(+2 more personal notes, not shown.)')).toBe(true)
  })
})

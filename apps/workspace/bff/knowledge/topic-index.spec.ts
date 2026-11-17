/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { quoted, TOPIC_INDEX_MAX_CHARS, TOPIC_INDEX_MAX_TOPICS, topicIndexLine } from './topic-index'

describe('quoted', () => {
  it('collapses whitespace and escapes quotes and backslashes', () => {
    expect(quoted('  Say   "hi"\nback\\slash ')).toBe('"Say \\"hi\\" back\\\\slash"')
  })
})

describe('topicIndexLine', () => {
  it('answers null for no topic', () => {
    expect(topicIndexLine('topics of the project', [])).toBeNull()
  })

  it('opens with the lead, the bounds and the topics with their counts', () => {
    expect(
      topicIndexLine("topics of the person's 3 notes", [
        { name: 'Brandschutz', count: 2 },
        { name: 'Stellplätze', count: 1 },
      ])
    ).toBe(
      `topics of the person's 3 notes (at most ${TOPIC_INDEX_MAX_TOPICS} named): "Brandschutz" (2), "Stellplätze" (1)`
    )
  })

  it('names at most the topic bound and says how many it left out', () => {
    const topics = Array.from({ length: TOPIC_INDEX_MAX_TOPICS + 3 }, (_, index) => ({
      name: `T${String(index).padStart(2, '0')}`,
      count: 1,
    }))
    const line = topicIndexLine('topics', topics) as string

    expect(line.split(' (1)').length - 1).toBe(TOPIC_INDEX_MAX_TOPICS)
    expect(line.endsWith(', (+3 more topics, not named)')).toBe(true)
  })

  it('stops naming topics once the character budget is spent, and says so', () => {
    const topics = Array.from({ length: 10 }, (_, index) => ({ name: 'x'.repeat(60) + index, count: 1 }))
    const line = topicIndexLine('topics', topics) as string

    expect(line.length).toBeLessThanOrEqual(TOPIC_INDEX_MAX_CHARS + 40)
    expect(line).toMatch(/\(\+\d+ more topics, not named\)$/)
  })
})

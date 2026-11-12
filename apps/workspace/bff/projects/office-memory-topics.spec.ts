/**
 * @vitest-environment node
 *
 * The office shelf's topics (ADR-0180): the list counts the active office notes
 * over the whole shelf, and a write's topic is resolved against the open
 * office notes' topics before it is stored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as { topic: string | null }[],
  queries: 0,
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: () => {
      h.queries += 1
      return { from: () => ({ where: async () => h.rows }) }
    },
  }),
}))

import { officeTopicsOf, withOfficeTopic } from './office-memory-topics'

const ORG = 'org_1'

beforeEach(() => {
  h.rows = []
  h.queries = 0
})

describe('officeTopicsOf', () => {
  it('counts the shelf’s notes per topic and leaves out the notes with no topic', async () => {
    h.rows = [{ topic: 'Brandschutz' }, { topic: 'Brandschutz' }, { topic: 'Stellplätze' }, { topic: null }]

    await expect(officeTopicsOf(ORG)).resolves.toEqual([
      { name: 'Brandschutz', count: 2 },
      { name: 'Stellplätze', count: 1 },
    ])
  })

  it('answers no topics for a shelf without any', async () => {
    h.rows = [{ topic: null }]

    await expect(officeTopicsOf(ORG)).resolves.toEqual([])
  })
})

describe('withOfficeTopic', () => {
  it('passes a body that names no topic through unchanged, without a lookup', async () => {
    const input = { kind: 'decision', content: 'Die Attika ist 1,20 m hoch.', topic: undefined }

    await expect(withOfficeTopic(ORG, input)).resolves.toBe(input)
    expect(h.queries).toBe(0)
  })

  it('resolves a named topic to the office shelf’s spelling', async () => {
    h.rows = [{ topic: 'Brandschutz' }]

    await expect(withOfficeTopic(ORG, { topic: 'brandschutz' })).resolves.toEqual({ topic: 'Brandschutz' })
  })

  it('keeps a new name as it is written, and null as the way to take a note out of its topic', async () => {
    h.rows = [{ topic: 'Brandschutz' }]

    await expect(withOfficeTopic(ORG, { topic: 'Zufahrt' })).resolves.toEqual({ topic: 'Zufahrt' })
    await expect(withOfficeTopic(ORG, { topic: null })).resolves.toEqual({ topic: null })
  })
})

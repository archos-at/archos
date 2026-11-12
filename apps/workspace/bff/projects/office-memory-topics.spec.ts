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
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => h.rows }) }),
  }),
}))

vi.mock('./memory-topics', () => ({
  resolveOfficeTopicForWrite: vi.fn(async (_organizationId: string, raw: unknown) =>
    raw === 'brandschutz' ? 'Brandschutz' : (raw ?? null)
  ),
}))

import { resolveOfficeTopicForWrite } from './memory-topics'
import { officeTopicsOf, withOfficeTopic } from './office-memory-topics'

const ORG = 'org_1'

beforeEach(() => {
  vi.clearAllMocks()
  h.rows = []
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
    expect(resolveOfficeTopicForWrite).not.toHaveBeenCalled()
  })

  it('resolves a named topic to the office shelf’s spelling', async () => {
    await expect(withOfficeTopic(ORG, { topic: 'brandschutz' })).resolves.toEqual({ topic: 'Brandschutz' })
    expect(resolveOfficeTopicForWrite).toHaveBeenCalledWith(ORG, 'brandschutz')
  })

  it('keeps null as the way to take a note out of its topic', async () => {
    await expect(withOfficeTopic(ORG, { topic: null })).resolves.toEqual({ topic: null })
    expect(resolveOfficeTopicForWrite).toHaveBeenCalledWith(ORG, null)
  })
})

/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ getDb: () => mockDb }))

import {
  countDistinctHumanAuthors,
  findStoredEngagement,
  resolveEngagement,
  setEngagement,
  suggestEngagement,
} from './engagement'

const stubSelect = (rows: unknown[]) => {
  const chain = {
    from: () => chain,
    where: () => Object.assign(Promise.resolve(rows), chain),
    limit: () => Promise.resolve(rows),
  }
  mockDb.select.mockReturnValue(chain)
}

const stubUpdate = (rows: unknown[]) => {
  const chain = {
    set: () => chain,
    where: () => chain,
    returning: () => Promise.resolve(rows),
  }
  mockDb.update.mockReturnValue(chain)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('suggestEngagement', () => {
  it('suggests nothing for a thread one person has written in', () => {
    expect(suggestEngagement(0)).toBeNull()
    expect(suggestEngagement(1)).toBeNull()
  })

  it('suggests mention once a second person has written', () => {
    expect(suggestEngagement(2)).toBe('mention')
    expect(suggestEngagement(7)).toBe('mention')
  })
})

describe('countDistinctHumanAuthors', () => {
  it('reads the distinct-author count', async () => {
    stubSelect([{ count: 3 }])
    await expect(countDistinctHumanAuthors('conv_1', 'org-1')).resolves.toBe(3)
  })

  it('treats an empty thread as nobody rather than throwing', async () => {
    stubSelect([])
    await expect(countDistinctHumanAuthors('conv_1', 'org-1')).resolves.toBe(0)
  })
})

describe('resolveEngagement', () => {
  it('is ask when nobody has chosen, however many people are talking', async () => {
    stubSelect([{ count: 5 }])
    await expect(resolveEngagement('conv_1', 'org-1', null, { withSuggestion: true })).resolves.toEqual({
      mode: 'ask',
      stored: null,
      suggestion: 'mention',
    })
  })

  it('suggests nothing while one person is talking', async () => {
    stubSelect([{ count: 1 }])
    await expect(resolveEngagement('conv_1', 'org-1', null, { withSuggestion: true })).resolves.toEqual({
      mode: 'ask',
      stored: null,
      suggestion: null,
    })
  })

  it('obeys a stored mode, and stops suggesting once somebody has chosen', async () => {
    await expect(resolveEngagement('conv_1', 'org-1', 'mention', { withSuggestion: true })).resolves.toEqual(
      { mode: 'mention', stored: 'mention', suggestion: null },
    )
    expect(mockDb.select).not.toHaveBeenCalled()
  })

  it('counts nothing on the write path, where the suggestion is irrelevant', async () => {
    await expect(resolveEngagement('conv_1', 'org-1', null)).resolves.toEqual({
      mode: 'ask',
      stored: null,
      suggestion: null,
    })
    expect(mockDb.select).not.toHaveBeenCalled()
  })
})

describe('findStoredEngagement', () => {
  it('returns the column, and null for a thread that has none', async () => {
    stubSelect([{ engagement: 'mention' }])
    await expect(findStoredEngagement('conv_1', 'org-1')).resolves.toBe('mention')

    stubSelect([{ engagement: null }])
    await expect(findStoredEngagement('conv_1', 'org-1')).resolves.toBeNull()

    stubSelect([])
    await expect(findStoredEngagement('conv_1', 'org-1')).resolves.toBeNull()
  })
})

describe('setEngagement', () => {
  it('reports whether the row actually changed', async () => {
    stubUpdate([{ id: 'conv_1' }])
    await expect(setEngagement('conv_1', 'org_1', 'mention')).resolves.toBe(true)

    stubUpdate([])
    await expect(setEngagement('conv_1', 'org_1', 'mention')).resolves.toBe(false)
  })
})

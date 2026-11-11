/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
}))
vi.mock('@/lib/db/schema/project-memory', () => ({ projectMemory: { id: 'pm.id', content: 'pm.content' } }))
vi.mock('@/lib/knowledge/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge/embeddings')>()
  return { ...actual, embedNote: vi.fn(async () => null), embedNotes: vi.fn(async () => null) }
})

import { getDb } from '@/lib/db'
import { embedNotes } from '@/lib/knowledge/embeddings'
import { asDb } from '@/test-utils/db-fixtures'
import { backfillAfterRecall } from './memory-embedding'

const eq = (col: unknown, val: unknown) => ({ op: 'eq', col, val })
const and = (...conditions: unknown[]) => ({ op: 'and', conditions })

const note = (id: string, content: string, relevance: number | null = null) => ({
  id,
  kind: 'derived_fact',
  content,
  relevance,
})

function mockUpdates() {
  const where = vi.fn().mockResolvedValue([])
  const set = vi.fn().mockReturnValue({ where })
  vi.mocked(getDb).mockReturnValue(asDb({ update: vi.fn().mockReturnValue({ set }) }))
  return { set, where }
}

beforeEach(() => {
  vi.mocked(getDb).mockReset()
  vi.mocked(embedNotes).mockReset().mockResolvedValue(null)
})

describe('backfillAfterRecall', () => {
  it('stores a vector only on a row that still holds the text it was made from', async () => {
    const { set, where } = mockUpdates()
    vi.mocked(embedNotes).mockResolvedValue([{ vector: [1, 0], fingerprint: 'model-a' }])

    // The digest read this text; the note may be edited before the embed returns.
    backfillAfterRecall([note('n-1', 'Die Attika ist 1,10 m hoch')], [{ id: 'n-1', embeddingModel: null }], null, true)
    await vi.waitFor(() => expect(where).toHaveBeenCalled())

    expect(embedNotes).toHaveBeenCalledWith(['[derived_fact] Die Attika ist 1,10 m hoch'])
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ embedding: [1, 0], embeddingModel: 'model-a' }))
    expect(where).toHaveBeenCalledWith(and(eq('pm.id', 'n-1'), eq('pm.content', 'Die Attika ist 1,10 m hoch')))
  })

  it('embeds only the rows that carry no vector of the query model', async () => {
    mockUpdates()
    const embedded = { vector: [1, 0], fingerprint: 'model-a' }

    backfillAfterRecall(
      [note('current', 'a', 0.4), note('unscored-current', 'b'), note('other-model', 'c'), note('none', 'd')],
      [
        { id: 'current', embeddingModel: 'model-a' },
        { id: 'unscored-current', embeddingModel: 'model-a' },
        { id: 'other-model', embeddingModel: 'model-b' },
        { id: 'none', embeddingModel: null },
      ],
      embedded,
      false
    )

    expect(embedNotes).toHaveBeenCalledWith(['[derived_fact] c', '[derived_fact] d'])
  })

  it('does nothing when the build neither ranked by a vector nor skipped one', () => {
    backfillAfterRecall([note('n-1', 'a')], [{ id: 'n-1', embeddingModel: null }], null, false)
    expect(embedNotes).not.toHaveBeenCalled()
  })
})

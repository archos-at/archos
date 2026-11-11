import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/base-knowledge/text-guard', () => ({ heldAmong: vi.fn() }))
vi.mock('./facets-repository', () => ({ upsertSearchFacets: vi.fn(async (_org: string, rows: readonly unknown[]) => rows.length) }))

import { heldAmong } from '@/lib/base-knowledge/text-guard'
import { upsertSearchFacets } from './facets-repository'
import { projectReadings } from './facets-projector'

const reading = (documentId: string) => ({ documentId, metadata: { summary: 'Was der Text sagt' }, superseded: false })

beforeEach(() => {
  vi.mocked(heldAmong).mockReset()
})

describe('projecting readings into search rows', () => {
  it('writes no row for a base-knowledge copy whose text is held, and every other row', async () => {
    vi.mocked(heldAmong).mockResolvedValue(new Set(['held']))
    await projectReadings('org-1', [reading('held'), reading('open')])
    const rows = vi.mocked(upsertSearchFacets).mock.calls[0]?.[1] ?? []
    expect(rows.map((row) => row.documentId)).toEqual(['open'])
    expect(heldAmong).toHaveBeenCalledWith('org-1', ['held', 'open'])
  })
})

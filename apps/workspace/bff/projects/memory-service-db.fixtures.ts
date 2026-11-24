import { vi } from 'vitest'
import { getDb } from '@/lib/db'
import type { ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import { asDb } from '@/test-utils/db-fixtures'

export const mockSelectChain = (rows: unknown[]) => {
  const limit = vi.fn().mockResolvedValue(rows)
  const orderBy = vi.fn().mockImplementation(() => Object.assign(Promise.resolve(rows), { limit }))
  const where = vi
    .fn()
    .mockImplementation(() => Object.assign(Promise.resolve(rows), { orderBy, limit }))
  const from = vi.fn().mockReturnValue({ where })
  vi.mocked(getDb).mockReturnValue(asDb({ select: vi.fn().mockReturnValue({ from }) }))
  return { where, orderBy, limit }
}

export const mockNearDupChain = (candidates: unknown[]) => {
  const limit = vi
    .fn()
    .mockResolvedValueOnce([]) // exact-dup: nothing normalized-equal
    .mockResolvedValueOnce(candidates) // near-dup candidate scan
  const orderBy = vi.fn().mockReturnValue({ limit })
  const selectWhere = vi.fn().mockReturnValue({ orderBy })
  const from = vi.fn().mockReturnValue({ where: selectWhere })

  const updateReturning = vi.fn().mockResolvedValue([{ id: 'dup-1', confidence: 'high' }])
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning })
  const set = vi.fn().mockReturnValue({ where: updateWhere })
  const update = vi.fn().mockReturnValue({ set })

  const insertReturning = vi.fn().mockResolvedValue([{ id: 'new-1' }])
  const values = vi.fn().mockReturnValue({ returning: insertReturning })
  const insert = vi.fn().mockReturnValue({ values })

  vi.mocked(getDb).mockReturnValue(
    asDb({
      select: vi.fn().mockReturnValue({ from }),
      update,
      insert,
    })
  )
  return { set, values, insert, update, selectWhere }
}

export const mockSupersedeChain = (selectResults: unknown[][]) => {
  const limit = vi.fn()
  for (const rows of selectResults) limit.mockResolvedValueOnce(rows)
  limit.mockResolvedValue([])
  const orderBy = vi.fn().mockReturnValue({ limit })
  const selectWhere = vi.fn().mockReturnValue({ orderBy })
  const from = vi.fn().mockReturnValue({ where: selectWhere })

  const updateReturning = vi.fn().mockResolvedValue([{ id: 'dup-1', confidence: 'high' }])
  const set = vi
    .fn()
    .mockReturnValue({ where: vi.fn().mockReturnValue({ returning: updateReturning }) })
  const update = vi.fn().mockReturnValue({ set })

  const values = vi
    .fn()
    .mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'new-1' }]) })
  const insert = vi.fn().mockReturnValue({ values })

  const txReturning = vi.fn().mockResolvedValue([{ id: 'retired-1' }])
  const txWhere = vi.fn().mockReturnValue({ returning: txReturning })
  const txSet = vi.fn().mockReturnValue({ where: txWhere })
  const tx = { insert, update: vi.fn().mockReturnValue({ set: txSet }) }
  const transaction = vi.fn((run: (handle: typeof tx) => Promise<ProjectMemoryItem>) => run(tx))

  vi.mocked(getDb).mockReturnValue(
    asDb({
      select: vi.fn().mockReturnValue({ from }),
      update,
      insert,
      transaction,
    })
  )
  return { set, values, insert, update, selectWhere, transaction, txSet, txWhere, txReturning }
}

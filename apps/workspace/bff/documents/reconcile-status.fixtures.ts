import { vi } from 'vitest'
import { getDb } from '@/lib/db'
import { asDb } from '@/test-utils/db-fixtures'
import type { ReconcilableDocument } from './reconcile-status'

export const makeDbMock = ({ moved = true }: { moved?: boolean } = {}) => {
  const movedRow = {
    scope: 'project',
    projectId: 'p1',
    filename: 'a.pdf',
    createdBy: 'user-1',
    status: 'completed',
    screeningOutcome: null,
    screenedHash: 'sha256:judged',
    dispatchedHash: 'sha256:judged',
  }
  const returning = vi.fn().mockResolvedValue(moved ? [movedRow] : [])
  const where = vi.fn().mockReturnValue({ returning })
  const set = vi.fn().mockReturnValue({ where })
  const update = vi.fn().mockReturnValue({ set })
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn().mockReturnValue({ onConflictDoNothing })
  const insert = vi.fn().mockReturnValue({ values })
  const transaction = vi.fn((run: (tx: unknown) => Promise<unknown>) => run({ update, insert }))
  vi.mocked(getDb).mockReturnValue(asDb({ transaction }))
  return { update, set, where, insert, values }
}

export const makeRow = (overrides: Partial<ReconcilableDocument> = {}): ReconcilableDocument => ({
  id: 'doc-1',
  status: 'pending',
  filename: 'plan.pdf',
  collectionName: 'proj_abc',
  authoredBy: 'user',
  publishedVersionId: null,
  errorMessage: null,
  metadata: { ingestJobId: 'job-1' },
  ...overrides,
})

export const mockFetch = vi.fn()

export const batchResponse = (statuses: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ statuses }),
})

export const collectionResponse = (files: unknown[]) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(files),
})

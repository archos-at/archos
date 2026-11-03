/**
 * @vitest-environment node
 *
 * The sweep that reads back dispatched ingests nobody is waiting on: which rows
 * it asks for, and that each organization is reconciled inside its own tenant,
 * one failure never costing the others their turn.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./repository', () => ({ listStalePendingDocuments: vi.fn() }))
vi.mock('./reconcile-status', () => ({ reconcileDocumentStatuses: vi.fn() }))

import { getTenantContext } from '@/lib/db/tenant-context'
import { reconcileDocumentStatuses } from './reconcile-status'
import { listStalePendingDocuments } from './repository'
import { STALE_PENDING_AFTER_MINUTES, STALE_PENDING_BATCH, reconcileStalePending } from './stale-pending'

type Rows = Awaited<ReturnType<typeof listStalePendingDocuments>>
const row = (id: string, organizationId: string) => ({ id, organizationId }) as unknown as Rows[number]
const NOW = new Date('2026-11-02T18:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listStalePendingDocuments).mockResolvedValue([])
  vi.mocked(reconcileDocumentStatuses).mockResolvedValue([])
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('reconcileStalePending', () => {
  it('asks for dispatches older than the grace, a bounded batch', async () => {
    await reconcileStalePending(NOW)

    expect(listStalePendingDocuments).toHaveBeenCalledWith(
      new Date(NOW.getTime() - STALE_PENDING_AFTER_MINUTES * 60_000),
      STALE_PENDING_BATCH
    )
  })

  it('reconciles each organization rows together, inside that organization', async () => {
    vi.mocked(listStalePendingDocuments).mockResolvedValue([row('a', 'org_1'), row('b', 'org_2'), row('c', 'org_1')])
    const seen: Array<[unknown, string[]]> = []
    vi.mocked(reconcileDocumentStatuses).mockImplementation(async (rows) => {
      seen.push([getTenantContext(), rows.map((r) => r.id)])
      return []
    })

    const result = await reconcileStalePending(NOW)

    expect(seen).toEqual([
      [expect.objectContaining({ kind: 'tenant', organizationId: 'org_1' }), ['a', 'c']],
      [expect.objectContaining({ kind: 'tenant', organizationId: 'org_2' }), ['b']],
    ])
    expect(result).toEqual({ checked: 3, organizations: 2, errors: 0 })
    expect(vi.mocked(reconcileDocumentStatuses).mock.calls.map((call) => call[2])).toEqual(['sweep', 'sweep'])
  })

  it('goes on to the next organization when one throws', async () => {
    vi.mocked(listStalePendingDocuments).mockResolvedValue([row('a', 'org_1'), row('b', 'org_2')])
    vi.mocked(reconcileDocumentStatuses).mockRejectedValueOnce(new Error('boom'))

    const result = await reconcileStalePending(NOW)

    expect(reconcileDocumentStatuses).toHaveBeenCalledTimes(2)
    expect(result.errors).toBe(1)
  })
})

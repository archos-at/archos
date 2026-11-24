/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))

const canManageBudgets = vi.fn(() => false)
vi.mock('@/lib/authz/organizations', () => ({ canManageBudgets: () => canManageBudgets() }))
vi.mock('@/lib/llm-credentials/service', () => ({ isOrgOnOwnKey: async () => false }))
vi.mock('@/lib/pricing/service', () => ({
  getEffectivePricing: async () => ({ defaultOrgDailyCredits: 100, defaultOrgMonthlyCredits: 1000 }),
  creditsToCostUsd: (credits: number) => credits / 100,
}))
vi.mock('@/lib/cache', () => ({
  getCached: async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
  invalidateCached: async () => {},
  invalidateCachedPrefix: async () => {},
}))

const window = (credits: number, ingestCredits: number, events: number, ingestEvents: number) => ({
  costUsd: 0,
  ownKeyCostUsd: 0,
  priceUsd: 0,
  credits,
  tokens: 0,
  events,
  ingestCredits,
  ingestTokens: 0,
  ingestEvents,
})

const OFFICE_MONTH = window(3400, 3000, 60, 40)
const ANNA_MONTH = window(300, 200, 9, 4)

const scoped = (filter?: { userId?: string; projectId?: string }): boolean =>
  Boolean(filter?.userId ?? filter?.projectId)

vi.mock('./repository', async (original) => ({
  ...(await original<typeof import('./repository')>()),
  findActivePolicy: async () => null,
  aggregateSpendByMember: async () => [],
  aggregateDailySpend: async () => [],
  sumRollupTotals: async (_organizationId: string, filter?: { userId?: string; projectId?: string }) => {
    const month = scoped(filter) ? ANNA_MONTH : OFFICE_MONTH
    return { day: month, month }
  },
  aggregateSpendSummary: async (_organizationId: string, filter?: { userId?: string; projectId?: string }) => {
    const month = scoped(filter) ? ANNA_MONTH : OFFICE_MONTH
    return {
      day: month,
      month,
      perModel: [
        { model: 'answers', day: window(100, 0, 5, 0), month: window(100, 0, 5, 0) },
        { model: 'embeddings', day: window(200, 200, 4, 4), month: window(200, 200, 4, 4) },
      ],
    }
  },
}))

import { getUsageOverview } from './usage-overview'

const anna = { organizationId: 'org_1', userId: 'anna' } as AuthorizedSession

beforeEach(() => {
  canManageBudgets.mockReturnValue(false)
})

describe('the ingest meter of the usage overview', () => {
  it('shows a member the office-wide ingestion against the office-wide ceiling, beside their own work', async () => {
    const overview = await getUsageOverview(anna)
    expect(overview.summary.month).toEqual({ amount: 100, events: 5 })
    expect(overview.ingest).toEqual({ month: { amount: 3000, events: 40 }, monthlyLimit: 3000 })
  })

  it('stays office-wide when an admin filters by member', async () => {
    canManageBudgets.mockReturnValue(true)
    const overview = await getUsageOverview(anna, { userId: 'ben' })
    expect(overview.summary.month).toEqual({ amount: 100, events: 5 })
    expect(overview.ingest.month).toEqual({ amount: 3000, events: 40 })
  })

  it('lists no model whose month was ingestion only', async () => {
    const overview = await getUsageOverview(anna)
    expect(overview.summary.perModel.map((entry) => entry.model)).toEqual(['answers'])
  })
})

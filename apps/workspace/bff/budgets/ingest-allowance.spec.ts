/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetPolicy, NewLlmUsageEvent } from '@/lib/db/schema/budgets'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/authz/organizations', () => ({ canManageBudgets: () => true }))
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))

const isOrgOnOwnKey = vi.fn(async (_organizationId: string) => false)
vi.mock('@/lib/llm-credentials/service', () => ({ isOrgOnOwnKey: (id: string) => isOrgOnOwnKey(id) }))

vi.mock('@/lib/pricing/service', () => ({
  getEffectivePricing: async () => ({ defaultOrgDailyCredits: 100, defaultOrgMonthlyCredits: 1000 }),
  creditsToCostUsd: (credits: number) => credits / 100,
}))

vi.mock('@/lib/cache', () => ({
  getCached: async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
  invalidateCached: async () => {},
  invalidateCachedPrefix: async () => {},
}))

const findActivePolicy = vi.fn<(...args: unknown[]) => Promise<BudgetPolicy | null>>()
const sumRollupTotals = vi.fn()

vi.mock('./repository', async (original) => ({
  ...(await original<typeof import('./repository')>()),
  findActivePolicy: (...args: unknown[]) => findActivePolicy(...args),
  sumRollupTotals: (...args: unknown[]) => sumRollupTotals(...args),
}))

import { getBudgetStatus } from './budget-status'
import { getIngestAllowance, ingestAllowanceSpent, ingestBudgetSnapshot } from './ingest-allowance'
import { buildRollupIncrements } from './repository'
import { toTenantIngestWindow, toTenantWindow } from './spend-windows'

const window = (credits: number, ingestCredits = 0, tokens = 0, ingestTokens = 0) => ({
  costUsd: 0,
  ownKeyCostUsd: 0,
  priceUsd: 0,
  credits,
  tokens,
  events: 10,
  ingestCredits,
  ingestTokens,
  ingestEvents: 4,
})

const policy = (over: Partial<BudgetPolicy>): BudgetPolicy =>
  ({ currency: 'credit', dailyLimit: null, monthlyLimit: null, ...over }) as BudgetPolicy

const event = (over: Partial<NewLlmUsageEvent>): NewLlmUsageEvent => ({
  organizationId: 'org_1',
  userId: 'anna',
  projectId: 'p1',
  credits: '10',
  totalTokens: 500,
  createdAt: new Date('2026-11-18T10:00:00Z'),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  isOrgOnOwnKey.mockResolvedValue(false)
  findActivePolicy.mockResolvedValue(null)
})

describe('the rollup keeps the ingest share of a day apart', () => {
  it('counts an ingest event in the totals and in the ingest columns, a turn in the totals only', () => {
    const [row] = buildRollupIncrements([event({ activity: 'ingest', credits: '90' }), event({ credits: '9' })])
    expect(row).toMatchObject({ credits: 99, tokens: 1000, events: 2, ingestCredits: 90, ingestTokens: 500, ingestEvents: 1 })
  })

  it('keeps unbilled dictation out of both', () => {
    expect(buildRollupIncrements([event({ activity: 'dictation' })])).toEqual([])
  })
})

describe('the limits of day-to-day work leave ingestion out', () => {
  it('does not block chat after an upload that alone exceeds the daily limit', async () => {
    sumRollupTotals.mockResolvedValue({ day: window(99, 90), month: window(99, 90) })
    const status = await getBudgetStatus('org_1', null, null)
    expect(status.blocked).toBe(false)
    expect(status.remainingOrg).toBe(91)
  })

  it('still blocks when the work itself reaches the limit', async () => {
    sumRollupTotals.mockResolvedValue({ day: window(190, 90), month: window(190, 90) })
    expect((await getBudgetStatus('org_1', null, null)).blocked).toBe(true)
  })

  it('shows a tenant the two shares separately', () => {
    expect(toTenantWindow('credit')(window(99, 90))).toEqual({ amount: 9, events: 6 })
    expect(toTenantIngestWindow('credit')(window(99, 90))).toEqual({ amount: 90, events: 4 })
  })
})

describe('the ingest allowance', () => {
  it('is three times the monthly limit, spent by the month\'s ingestion only', async () => {
    sumRollupTotals.mockResolvedValue({ day: window(0), month: window(2500, 2000) })
    expect(await getIngestAllowance('org_1')).toEqual({ unit: 'credit', limit: 3000, used: 2000, remaining: 1000, spent: false })
  })

  it('follows an explicit monthly limit', async () => {
    findActivePolicy.mockResolvedValue(policy({ monthlyLimit: '5000' }))
    sumRollupTotals.mockResolvedValue({ day: window(0), month: window(0) })
    expect((await getIngestAllowance('org_1')).limit).toBe(15000)
  })

  it('is unlimited where the month is, and counts tokens on an own key', async () => {
    isOrgOnOwnKey.mockResolvedValue(true)
    sumRollupTotals.mockResolvedValue({ day: window(0), month: window(0, 0, 9000, 7000) })
    expect(await getIngestAllowance('org_1')).toEqual({ unit: 'token', limit: null, used: 7000, remaining: null, spent: false })
  })

  it('is spent at its ceiling, and reads as not spent when it cannot be read', async () => {
    sumRollupTotals.mockResolvedValue({ day: window(0), month: window(3000, 3000) })
    expect(await ingestAllowanceSpent('org_1')).toBe(true)
    sumRollupTotals.mockRejectedValue(new Error('db down'))
    expect(await ingestAllowanceSpent('org_1')).toBe(false)
  })

  it('hands a reading after an upload what is left of it, marked as ingestion', async () => {
    sumRollupTotals.mockResolvedValue({ day: window(0), month: window(2500, 2000) })
    expect(await ingestBudgetSnapshot('org_1')).toEqual({
      activity: 'ingest',
      remainingOrgUsd: 10,
      remainingUserUsd: null,
      remainingProjectUsd: null,
      remainingOrgTokens: null,
      remainingUserTokens: null,
      remainingProjectTokens: null,
    })
  })
})

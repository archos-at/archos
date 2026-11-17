import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('budgets service against live Postgres', () => {
  const inTenant = async <T>(organizationId: string, run: () => Promise<T>): Promise<T> => {
    const { withTenant } = await import('@/lib/db/tenant-context')
    return withTenant({ organizationId, userId: 'user_1' }, run)
  }

  beforeAll(() => {
    process.env.APP_DATABASE_URL = url
  })

  afterAll(async () => {
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('records events, aggregates spend per model, computes budget status', async () => {
    const { getBudgetStatus, getOrgBudget, getSpendSummary, recordUsageEvents, setBudgetPolicy } =
      await import('./service')

    const org = `org_test_${Date.now()}`
    await inTenant(org, async () => {
      const empty = await getSpendSummary(org)
      expect(empty.perModel).toEqual([])
      expect(empty.month.credits).toBe(0)
      const orgBudget = await getOrgBudget(org)
      expect(orgBudget).toMatchObject({
        explicit: false,
        unit: 'credit',
        dailyLimit: 1000,
        monthlyLimit: 10000,
      })

      await recordUsageEvents([
        {
          organizationId: org,
          userId: 'user_1',
          projectId: null,
          conversationId: 'conv-1',
          jobId: null,
          requestedModel: 'deepseek/deepseek-v4-flash',
          model: 'deepseek/deepseek-v4-flash',
          generationId: 'gen-1',
          promptTokens: 1000,
          completionTokens: 200,
          totalTokens: 1200,
          cachedTokens: 0,
          reasoningTokens: 0,
          costUsd: '0.00214000',
          costSource: 'usage_field',
          isByok: false,
        },
        {
          organizationId: org,
          userId: 'user_2',
          projectId: null,
          conversationId: 'conv-2',
          jobId: null,
          requestedModel: null,
          model: 'anthropic/claude-sonnet-4.5',
          generationId: 'gen-2',
          promptTokens: 500,
          completionTokens: 100,
          totalTokens: 600,
          cachedTokens: 0,
          reasoningTokens: 50,
          costUsd: '0.01000000',
          costSource: 'usage_field',
          isByok: null,
        },
      ])

      const summary = await getSpendSummary(org)
      expect(summary.perModel).toHaveLength(2)
      expect(summary.month.costUsd).toBeCloseTo(0.01214, 6)
      expect(summary.day.costUsd).toBeCloseTo(0.01214, 6)
      expect(summary.month.priceUsd).toBeCloseTo(0.01214, 6)
      expect(summary.month.credits).toBeCloseTo(1.214, 4)
      const models = Object.fromEntries(summary.perModel.map((m) => [m.model, m]))
      expect(models['anthropic/claude-sonnet-4.5'].month.costUsd).toBeCloseTo(0.01, 6)
      expect(models['deepseek/deepseek-v4-flash'].day.events).toBe(1)

      const userSummary = await getSpendSummary(org, { userId: 'user_1' })
      expect(userSummary.month.costUsd).toBeCloseTo(0.00214, 6)

      const { getSpendTotals } = await import('./service')
      const totals = await getSpendTotals(org)
      expect(totals.month.costUsd).toBeCloseTo(0.01214, 6)
      expect(totals.day.costUsd).toBeCloseTo(0.01214, 6)
      expect(totals.month.credits).toBeCloseTo(1.214, 4)
      expect(totals.month.tokens).toBe(1800)
      expect(totals.month.ownKeyCostUsd).toBe(0)
      const userTotals = await getSpendTotals(org, { userId: 'user_1' })
      expect(userTotals.month.costUsd).toBeCloseTo(0.00214, 6)

      const { getSpendByMember } = await import('./service')
      const perMember = await getSpendByMember(org)
      expect(perMember.map((m) => m.userId)).toEqual(['user_1', 'user_2'])
      expect(perMember[1].month.costUsd).toBeCloseTo(0.01, 6)
      expect(perMember[1].day.events).toBe(1)

      const status = await getBudgetStatus(org, 'user_1', null)
      expect(status.blocked).toBe(false)
      expect(status.remainingOrgUsd).toBeGreaterThan(0)
      expect(status.remainingUserUsd).toBeNull() // no member policy set

      await setBudgetPolicy({
        organizationId: org,
        scope: 'organization',
        subjectId: null,
        dailyLimit: 0.1,
        monthlyLimit: 10000,
        actorUserId: 'admin_1',
      })
      const blocked = await getBudgetStatus(org, 'user_1', null)
      expect(blocked.blocked).toBe(true)
      expect(blocked.blockedScope).toBe('organization')

      await expect(
        setBudgetPolicy({
          organizationId: org,
          scope: 'member',
          subjectId: 'user_1',
          dailyLimit: 5,
          monthlyLimit: 20000,
          actorUserId: 'admin_1',
        })
      ).rejects.toThrow(/exceeds the organization/)
    })
  })

  it('counts ingestion apart, as platform cost only when not on a tenant key', async () => {
    const { getSpendSummary, recordUsageEvents } = await import('./service')
    const org = `org_ingest_${Date.now()}`
    const event = (costUsd: string, activity: 'ingest' | null, isByok: boolean | null) => ({
      organizationId: org,
      userId: 'user_1',
      projectId: null,
      conversationId: null,
      jobId: activity ? 'job-1' : null,
      requestedModel: null,
      model: 'qwen/qwen3-vl',
      generationId: null,
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd,
      costSource: 'usage_field' as const,
      isByok,
      activity,
    })

    await inTenant(org, async () => {
      await recordUsageEvents([
        event('0.03000000', 'ingest', false),
        event('0.50000000', 'ingest', true),
        event('0.01000000', null, false),
      ])

      const summary = await getSpendSummary(org)
      expect(summary.month.costUsd).toBeCloseTo(0.54, 6)
      expect(summary.month.ingestCostUsd).toBeCloseTo(0.03, 6)
      expect(summary.day.ingestCostUsd).toBeCloseTo(0.03, 6)
    })

    const { withPlatformAccess } = await import('@/lib/db/tenant-context')
    const { aggregateSpendAcrossOrganizations } = await import('./repository')
    const perOrg = await withPlatformAccess(
      'test: platform overview',
      aggregateSpendAcrossOrganizations
    )
    expect(perOrg.find((row) => row.organizationId === org)?.month.ingestCostUsd).toBeCloseTo(
      0.03,
      6
    )
  })

  it('books voice dictation at its real cost, bills nobody and leaves every budget alone', async () => {
    const { getSpendSummary, getSpendTotals, recordUsageEvents } = await import('./service')
    const org = `org_dictation_${Date.now()}`
    const dictation = {
      organizationId: org,
      userId: 'user_1',
      projectId: null,
      conversationId: null,
      jobId: null,
      requestedModel: 'elevenlabs/scribe-v2',
      model: 'elevenlabs/scribe-v2',
      generationId: null,
      promptTokens: 300,
      completionTokens: 40,
      totalTokens: 340,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: '0.00420000',
      costSource: 'usage_field' as const,
      isByok: false,
      activity: 'dictation' as const,
      agentGroup: 'dictation',
      audioSeconds: '12.40',
    }

    await inTenant(org, async () => {
      await recordUsageEvents([dictation])

      const summary = await getSpendSummary(org)
      expect(summary.month.costUsd).toBeCloseTo(0.0042, 6)
      expect(summary.month.dictationCostUsd).toBeCloseTo(0.0042, 6)
      expect(summary.month.priceUsd).toBe(0)
      expect(summary.month.credits).toBe(0)

      const totals = await getSpendTotals(org, { userId: 'user_1' })
      expect(totals.month.events).toBe(0)
      expect(totals.month.tokens).toBe(0)
    })

    const { getDb } = await import('@/lib/db')
    const { llmUsageEvents } = await import('@/lib/db/schema')
    await expect(
      inTenant(org, () =>
        getDb()
          .insert(llmUsageEvents)
          .values({ ...dictation, priceUsd: '0.01000000', credits: '1.000000' })
      )
    ).rejects.toThrow()
  })
})

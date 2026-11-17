import 'server-only'
import * as repository from './repository'
import type { MemberSpend, OrganizationSpend, SpendSummary, SpendTotals, SpendWindow } from './repository'

export async function getSpendTotals(
  organizationId: string,
  filter: { userId?: string; projectId?: string } = {},
): Promise<SpendTotals> {
  return repository.sumRollupTotals(organizationId, filter)
}

export async function getSpendSummary(
  organizationId: string,
  filter: { userId?: string; projectId?: string } = {},
): Promise<SpendSummary> {
  return repository.aggregateSpendSummary(organizationId, filter)
}

export async function getSpendByMember(organizationId: string): Promise<MemberSpend[]> {
  return repository.aggregateSpendByMember(organizationId)
}

export async function getSpendAcrossOrganizations(): Promise<OrganizationSpend[]> {
  return repository.aggregateSpendAcrossOrganizations()
}

export interface DailySpendPoint extends SpendWindow {
  day: string
}

export async function getDailySpendTrend(options: {
  organizationId?: string
  days?: number
} = {}): Promise<DailySpendPoint[]> {
  const days = Math.min(Math.max(options.days ?? 30, 1), 90)
  const start = repository.utcDayStart()
  start.setUTCDate(start.getUTCDate() - (days - 1))

  const rows = await repository.aggregateDailySpend({ organizationId: options.organizationId, start })

  const byDay = new Map(rows.map((row) => [row.day, row]))
  const series: DailySpendPoint[] = []
  const cursor = new Date(start)
  for (let i = 0; i < days; i += 1) {
    const key = cursor.toISOString().slice(0, 10)
    const row = byDay.get(key)
    series.push({
      day: key,
      costUsd: row?.costUsd ?? 0,
      ownKeyCostUsd: row?.ownKeyCostUsd ?? 0,
      priceUsd: row?.priceUsd ?? 0,
      credits: row?.credits ?? 0,
      tokens: row?.tokens ?? 0,
      events: row?.events ?? 0,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return series
}

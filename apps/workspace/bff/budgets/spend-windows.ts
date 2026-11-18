import 'server-only'
import type { BudgetUnit } from '@/lib/db/schema/budgets'
import type { SpendWindow } from './repository'

export const ingested = (window: SpendWindow, unit: BudgetUnit): number =>
  (unit === 'token' ? window.ingestTokens : window.ingestCredits) ?? 0

export const consumed = (window: SpendWindow, unit: BudgetUnit): number =>
  Math.max(0, (unit === 'token' ? window.tokens : window.credits) - ingested(window, unit))

export interface TenantSpendWindow {
  amount: number
  events: number
}

export const toTenantWindow =
  (unit: BudgetUnit) =>
  (window: SpendWindow): TenantSpendWindow => ({
    amount: consumed(window, unit),
    events: Math.max(0, window.events - (window.ingestEvents ?? 0)),
  })

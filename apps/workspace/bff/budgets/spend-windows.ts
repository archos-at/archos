import 'server-only'
import type { BudgetUnit } from '@/lib/db/schema/budgets'
import type { SpendWindow } from './repository'

export const consumed = (window: SpendWindow, unit: BudgetUnit): number =>
  unit === 'token' ? window.tokens : window.credits

export interface TenantSpendWindow {
  amount: number
  events: number
}

export const toTenantWindow =
  (unit: BudgetUnit) =>
  (window: SpendWindow): TenantSpendWindow => ({
    amount: consumed(window, unit),
    events: window.events,
  })

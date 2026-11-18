import 'server-only'
import type { BudgetUnit } from '@/lib/db/schema/budgets'
import { creditsToCostUsd, getEffectivePricing } from '@/lib/pricing/service'
import type { BudgetSnapshot } from '@/lib/request-context'
import { getCachedOrgLimits } from './limits-cache'
import { ingestLimitOf } from './ingest-limit'
import { getOrgBudgetUnit } from './policy-lookup'
import { getSpendTotals } from './spend-queries'
import { ingested } from './spend-windows'

export interface IngestAllowance {
  unit: BudgetUnit
  limit: number | null
  used: number
  events: number
  remaining: number | null
  spent: boolean
}

export async function getIngestAllowance(organizationId: string): Promise<IngestAllowance> {
  const unit = await getOrgBudgetUnit(organizationId)
  const [limits, spend] = await Promise.all([getCachedOrgLimits(organizationId, unit), getSpendTotals(organizationId)])
  const limit = ingestLimitOf(limits)
  const used = ingested(spend.month, unit)
  const remaining = limit === null ? null : Math.max(0, limit - used)
  return {
    unit,
    limit,
    used,
    events: spend.month.ingestEvents ?? 0,
    remaining,
    spent: remaining !== null && remaining <= 0,
  }
}

export async function ingestAllowanceSpent(organizationId: string): Promise<boolean> {
  try {
    return (await getIngestAllowance(organizationId)).spent
  } catch (error) {
    console.warn('[budgets] the ingest allowance could not be read; reading the document in anyway', error)
    return false
  }
}

const UNCAPPED_INGEST_SNAPSHOT: BudgetSnapshot = {
  activity: 'ingest',
  remainingOrgUsd: null,
  remainingUserUsd: null,
  remainingProjectUsd: null,
  remainingOrgTokens: null,
  remainingUserTokens: null,
  remainingProjectTokens: null,
}

export async function ingestBudgetSnapshot(organizationId: string): Promise<BudgetSnapshot> {
  try {
    const allowance = await getIngestAllowance(organizationId)
    const pricing = allowance.unit === 'credit' && allowance.remaining !== null ? await getEffectivePricing() : null
    return {
      ...UNCAPPED_INGEST_SNAPSHOT,
      remainingOrgUsd: pricing && allowance.remaining !== null ? creditsToCostUsd(allowance.remaining, pricing) : null,
      remainingOrgTokens: allowance.unit === 'token' ? allowance.remaining : null,
    }
  } catch (error) {
    console.warn('[budgets] the ingest allowance could not be read; the reading is booked as ingestion without a cap', error)
    return UNCAPPED_INGEST_SNAPSHOT
  }
}

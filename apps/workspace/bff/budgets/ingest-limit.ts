import 'server-only'
import type { BudgetUnit } from '@/lib/db/schema/budgets'
import {
  INGEST_ALLOWANCE_SETTING,
  defaultIngestAllowance,
  type IngestAllowanceSetting,
} from './ingest-allowance-contract'

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

export function configuredIngestAllowances(settings: Record<string, unknown>): IngestAllowanceSetting {
  const raw = settings[INGEST_ALLOWANCE_SETTING]
  if (raw === null || typeof raw !== 'object') return {}
  const record = raw as Record<string, unknown>
  const configured: IngestAllowanceSetting = {}
  if (isAmount(record.credit)) configured.credit = record.credit
  if (isAmount(record.token)) configured.token = record.token
  return configured
}

export interface IngestLimit {
  limit: number | null
  defaultLimit: number | null
  explicit: boolean
}

export function effectiveIngestLimit(
  configured: IngestAllowanceSetting,
  unit: BudgetUnit,
  limits: { monthlyLimit: number | null },
): IngestLimit {
  const defaultLimit = defaultIngestAllowance(unit, limits.monthlyLimit)
  const own = configured[unit]
  return own === undefined
    ? { limit: defaultLimit, defaultLimit, explicit: false }
    : { limit: own, defaultLimit, explicit: true }
}

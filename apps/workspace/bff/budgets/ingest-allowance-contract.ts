import { z } from 'zod'

export const INGEST_ALLOWANCE_SETTING = 'ingestMonthlyAllowance'

export const MAX_INGEST_ALLOWANCE = 999_999_999_999

export type IngestAllowanceSetting = Partial<Record<'credit' | 'token', number>>

export const DEFAULT_CREDIT_INGEST_ALLOWANCE = 10_000

export const TOKEN_INGEST_ALLOWANCE_FACTOR = 3

export function defaultIngestAllowance(
  unit: 'credit' | 'token',
  monthlyLimit: number | null,
): number | null {
  if (unit === 'credit') return DEFAULT_CREDIT_INGEST_ALLOWANCE
  return monthlyLimit === null ? null : monthlyLimit * TOKEN_INGEST_ALLOWANCE_FACTOR
}

export const ingestAllowancePutSchema = z
  .object({
    unit: z.enum(['credit', 'token']),
    monthlyAllowance: z.number().finite().min(0).max(MAX_INGEST_ALLOWANCE).nullable(),
  })
  .strict()

export type IngestAllowancePut = z.infer<typeof ingestAllowancePutSchema>

export function withIngestAllowance(
  current: PlatformIngestAllowance,
  monthlyAllowance: number | null,
): PlatformIngestAllowance {
  return monthlyAllowance === null
    ? { ...current, monthlyAllowance: current.defaultMonthlyAllowance, explicit: false }
    : { ...current, monthlyAllowance, explicit: true }
}

export function withMonthlyLimit(
  current: PlatformIngestAllowance,
  monthlyLimit: number | null,
): PlatformIngestAllowance {
  const defaultMonthlyAllowance = defaultIngestAllowance(current.unit, monthlyLimit)
  return {
    ...current,
    defaultMonthlyAllowance,
    monthlyAllowance: current.explicit ? current.monthlyAllowance : defaultMonthlyAllowance,
  }
}

export interface PlatformIngestAllowance {
  unit: IngestAllowancePut['unit']
  monthlyAllowance: number | null
  defaultMonthlyAllowance: number | null
  explicit: boolean
  monthUsed: number
}

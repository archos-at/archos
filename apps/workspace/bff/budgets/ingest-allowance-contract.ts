import { z } from 'zod'

export const INGEST_ALLOWANCE_SETTING = 'ingestMonthlyAllowance'

export const MAX_INGEST_ALLOWANCE = 999_999_999_999

export type IngestAllowanceSetting = Partial<Record<'credit' | 'token', number>>

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

export interface PlatformIngestAllowance {
  unit: IngestAllowancePut['unit']
  monthlyAllowance: number | null,
  defaultMonthlyAllowance: number | null
  defaultFactor: number
  explicit: boolean
  monthUsed: number
}

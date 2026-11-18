import 'server-only'
import { getCached, invalidateCached } from '@/lib/cache'
import { UnprocessableError } from '@/lib/api/errors'
import type { PlatformPricingVersion } from '@/lib/db/schema/platform-pricing'
import type { PricingRates } from './model'
import { findActivePricingVersion, insertPricingVersionSuperseding, listPricingHistory } from './repository'

export { creditsToCostUsd, estimateCreditsPerRequest, priceUsage, REFERENCE_REQUEST } from './model'
export type { PricedUsage, PricingRates } from './model'

const PRICING_CACHE_TTL_MS = 60 * 1000
const PRICING_CACHE_KEY = 'platformpricing:active'

export const BOOT_FLOOR_MARGIN_MULTIPLIER = 1
export const BOOT_FLOOR_USD_PER_CREDIT = 0.01
export const BOOT_FLOOR_DAILY_CREDITS = 1_000
export const BOOT_FLOOR_MONTHLY_CREDITS = 10_000

export interface EffectivePricing extends PricingRates {
  versionId: string | null
  defaultOrgDailyCredits: number | null
  defaultOrgMonthlyCredits: number | null
  explicit: boolean
}

function bootFloor(): EffectivePricing {
  return {
    versionId: null,
    marginMultiplier: BOOT_FLOOR_MARGIN_MULTIPLIER,
    usdPerCredit: BOOT_FLOOR_USD_PER_CREDIT,
    defaultOrgDailyCredits: BOOT_FLOOR_DAILY_CREDITS,
    defaultOrgMonthlyCredits: BOOT_FLOOR_MONTHLY_CREDITS,
    explicit: false,
  }
}

const numberOrNull = (value: string | null): number | null =>
  value === null ? null : Number.parseFloat(value)

function toEffective(row: PlatformPricingVersion): EffectivePricing {
  return {
    versionId: row.id,
    marginMultiplier: Number.parseFloat(row.marginMultiplier),
    usdPerCredit: Number.parseFloat(row.usdPerCredit),
    defaultOrgDailyCredits: numberOrNull(row.defaultOrgDailyCredits),
    defaultOrgMonthlyCredits: numberOrNull(row.defaultOrgMonthlyCredits),
    explicit: true,
  }
}

export async function getEffectivePricing(): Promise<EffectivePricing> {
  return getCached(PRICING_CACHE_KEY, PRICING_CACHE_TTL_MS, async () => {
    const row = await findActivePricingVersion()
    return row ? toEffective(row) : bootFloor()
  })
}

export async function getEffectivePricingOrBootFloor(): Promise<EffectivePricing> {
  try {
    return await getEffectivePricing()
  } catch (error) {
    console.warn('[Pricing] Falling back to the boot floor — active pricing could not be read:', error)
    return bootFloor()
  }
}

export interface PricingView extends EffectivePricing {
  note: string | null
  updatedByEmail: string | null
  updatedAt: string | null
  history: Array<{
    id: string
    marginMultiplier: number
    usdPerCredit: number
    defaultOrgDailyCredits: number | null
    defaultOrgMonthlyCredits: number | null
    note: string | null
    createdByEmail: string | null
    createdAt: string
    status: PlatformPricingVersion['status']
  }>
}

export async function getPricingView(): Promise<PricingView> {
  const [active, history] = await Promise.all([findActivePricingVersion(), listPricingHistory(10)])
  const effective = active ? toEffective(active) : bootFloor()
  return {
    ...effective,
    note: active?.note ?? null,
    updatedByEmail: active?.createdByEmail ?? null,
    updatedAt: active?.createdAt.toISOString() ?? null,
    history: history.map((row) => ({
      id: row.id,
      marginMultiplier: Number.parseFloat(row.marginMultiplier),
      usdPerCredit: Number.parseFloat(row.usdPerCredit),
      defaultOrgDailyCredits: numberOrNull(row.defaultOrgDailyCredits),
      defaultOrgMonthlyCredits: numberOrNull(row.defaultOrgMonthlyCredits),
      note: row.note,
      createdByEmail: row.createdByEmail,
      createdAt: row.createdAt.toISOString(),
      status: row.status,
    })),
  }
}

export interface SavePricingInput {
  marginMultiplier: number
  usdPerCredit: number
  defaultOrgDailyCredits: number | null
  defaultOrgMonthlyCredits: number | null
  note: string | null
  actorUserId: string
  actorEmail: string | null
}

export const PRICING_BOUNDS = {
  marginMultiplier: { min: 0.1, max: 50 },
  usdPerCredit: { min: 0.0001, max: 100 },
  defaultCredits: { min: 0, max: 100_000_000 },
} as const

function validate(input: SavePricingInput): string[] {
  const errors: string[] = []
  const inRange = (label: string, value: number, bounds: { min: number; max: number }): void => {
    if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) {
      errors.push(`${label}: ${bounds.min}–${bounds.max}`)
    }
  }
  inRange('marginMultiplier', input.marginMultiplier, PRICING_BOUNDS.marginMultiplier)
  inRange('usdPerCredit', input.usdPerCredit, PRICING_BOUNDS.usdPerCredit)
  for (const [label, value] of [
    ['defaultOrgDailyCredits', input.defaultOrgDailyCredits],
    ['defaultOrgMonthlyCredits', input.defaultOrgMonthlyCredits],
  ] as const) {
    if (value !== null) inRange(label, value, PRICING_BOUNDS.defaultCredits)
  }
  return errors
}

export async function savePricing(input: SavePricingInput): Promise<PlatformPricingVersion> {
  const errors = validate(input)
  if (errors.length > 0) {
    throw new UnprocessableError('Invalid pricing', { errors })
  }
  const inserted = await insertPricingVersionSuperseding({
    marginMultiplier: input.marginMultiplier.toFixed(4),
    usdPerCredit: input.usdPerCredit.toFixed(6),
    defaultOrgDailyCredits: input.defaultOrgDailyCredits === null ? null : input.defaultOrgDailyCredits.toFixed(4),
    defaultOrgMonthlyCredits:
      input.defaultOrgMonthlyCredits === null ? null : input.defaultOrgMonthlyCredits.toFixed(4),
    note: input.note,
    createdBy: input.actorUserId,
    createdByEmail: input.actorEmail,
  })
  await invalidateCached(PRICING_CACHE_KEY)
  return inserted
}

export async function invalidatePricingCache(): Promise<void> {
  await invalidateCached(PRICING_CACHE_KEY)
}

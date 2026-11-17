export interface PricingRates {
  marginMultiplier: number
  usdPerCredit: number
}

export interface PricedUsage {
  priceUsd: number
  credits: number
}

export function priceUsage(costUsd: number, isByok: boolean | null, rates: PricingRates): PricedUsage {
  if (isByok === true) return { priceUsd: 0, credits: 0 }
  const safeCost = Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0
  const priceUsd = safeCost * rates.marginMultiplier
  return { priceUsd, credits: priceUsd / rates.usdPerCredit }
}

export function creditsToCostUsd(credits: number, rates: PricingRates): number {
  return (credits * rates.usdPerCredit) / rates.marginMultiplier
}

export const REFERENCE_REQUEST = { promptTokens: 4_000, completionTokens: 800 } as const

export function estimateCreditsPerRequest(
  model: { promptPrice: number; completionPrice: number },
  rates: PricingRates,
): number {
  const costUsd =
    REFERENCE_REQUEST.promptTokens * model.promptPrice +
    REFERENCE_REQUEST.completionTokens * model.completionPrice
  return priceUsage(costUsd, false, rates).credits
}

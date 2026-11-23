import type { BimRuleResult } from './rule-types'

export interface BimCheckConfirmation {
  ruleId: string
  modelId: string
  confirmedBy: string
  note: string | null
  confirmedAt: string
}

export interface BimRuleResultWithConfirmation extends BimRuleResult {
  confirmation: BimCheckConfirmation | null
  confirmationStale: boolean
}

export function attachConfirmations(
  results: readonly BimRuleResult[],
  confirmations: readonly BimCheckConfirmation[],
  currentModelId: string,
  seriesModelIds: readonly string[] = [currentModelId]
): BimRuleResultWithConfirmation[] {
  const inSeries = new Set(seriesModelIds.length > 0 ? seriesModelIds : [currentModelId])
  inSeries.add(currentModelId)

  const byRule = new Map<string, BimCheckConfirmation>()
  for (const entry of confirmations) {
    if (!inSeries.has(entry.modelId)) continue
    const held = byRule.get(entry.ruleId)
    if (!held) {
      byRule.set(entry.ruleId, entry)
      continue
    }
    if (held.modelId === currentModelId) continue
    if (entry.modelId === currentModelId || entry.confirmedAt > held.confirmedAt) {
      byRule.set(entry.ruleId, entry)
    }
  }

  return results.map((result) => {
    const confirmation = result.hint ? null : (byRule.get(result.ruleId) ?? null)
    return {
      ...result,
      confirmation,
      confirmationStale: confirmation !== null && confirmation.modelId !== currentModelId,
    }
  })
}

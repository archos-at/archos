import type { BimRuleResult } from './rule-types'
import type { BimRuleResultWithConfirmation } from './rule-confirmations'

export const hasOpenWork = (result: BimRuleResult): boolean =>
  result.applicable && !result.hint && (result.failed > 0 || result.undecidable > 0)

export function rulesWithOpenWork<T extends BimRuleResult>(results: readonly T[]): T[] {
  return results.filter(hasOpenWork)
}

export function outstandingRules(
  results: readonly BimRuleResultWithConfirmation[]
): BimRuleResultWithConfirmation[] {
  return results.filter((result) => hasOpenWork(result) && (result.confirmation === null || result.confirmationStale))
}

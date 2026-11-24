import type { BimRuleResult } from './rule-types'

export interface BimComplianceSummary {
  rulesApplicable: number
  rulesNotApplicable: number
  rulesFailing: number
  rulesUndecidable: number
  rulesPassing: number
  rulesEmpty: number
  elementsFailed: number
  elementsUndecidable: number
}

export function summarizeBimRules(results: readonly BimRuleResult[]): BimComplianceSummary {
  const summary: BimComplianceSummary = {
    rulesApplicable: 0,
    rulesNotApplicable: 0,
    rulesFailing: 0,
    rulesUndecidable: 0,
    rulesPassing: 0,
    rulesEmpty: 0,
    elementsFailed: 0,
    elementsUndecidable: 0,
  }
  for (const result of results) {
    if (!result.applicable) {
      summary.rulesNotApplicable += 1
      continue
    }
    summary.rulesApplicable += 1
    summary.elementsFailed += result.failed
    summary.elementsUndecidable += result.undecidable
    const checked = result.passed + result.failed + result.undecidable
    if (checked === 0) summary.rulesEmpty += 1
    else if (result.failed > 0) summary.rulesFailing += 1
    else if (result.undecidable > 0) summary.rulesUndecidable += 1
    else summary.rulesPassing += 1
  }
  return summary
}

export function missingPropertyShoppingList(
  results: readonly BimRuleResult[]
): Array<{ path: string; elements: number; rules: string[] }> {
  const byPath = new Map<string, { elements: number; rules: Set<string> }>()
  for (const result of results) {
    if (!result.applicable) continue
    for (const entry of result.missing) {
      const bucket = byPath.get(entry.path) ?? { elements: 0, rules: new Set<string>() }
      bucket.elements += entry.elements
      bucket.rules.add(result.ruleId)
      byPath.set(entry.path, bucket)
    }
  }
  return [...byPath.entries()]
    .map(([path, bucket]) => ({ path, elements: bucket.elements, rules: [...bucket.rules].sort() }))
    .sort((a, b) => b.elements - a.elements || a.path.localeCompare(b.path))
}

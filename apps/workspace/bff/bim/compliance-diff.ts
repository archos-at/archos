import type { BimRuleResult } from './rules'

export type BimComplianceTrend =
  | 'resolved'
  | 'broken'
  | 'decidable'
  | 'undecidable'
  | 'moved'

export interface BimComplianceChange {
  ruleId: string
  titleDe: string
  richtlinie: string
  trend: BimComplianceTrend
  before: { passed: number; failed: number; undecidable: number }
  after: { passed: number; failed: number; undecidable: number }
}

function standing(result: BimRuleResult): 'pass' | 'fail' | 'unknown' | 'empty' {
  if (!result.applicable) return 'empty'
  if (result.failed > 0) return 'fail'
  if (result.passed === 0 && result.undecidable === 0) return 'empty'
  if (result.undecidable > 0) return 'unknown'
  return 'pass'
}

export function diffBimCompliance(
  before: readonly BimRuleResult[],
  after: readonly BimRuleResult[]
): BimComplianceChange[] {
  const previous = new Map(before.map((result) => [result.ruleId, result]))
  const changes: BimComplianceChange[] = []

  for (const now of after) {
    const then = previous.get(now.ruleId)
    if (!then) continue
    const from = standing(then)
    const to = standing(now)

    let trend: BimComplianceTrend | null = null
    if (from !== to) {
      if (to === 'pass') trend = from === 'unknown' ? 'decidable' : 'resolved'
      else if (to === 'fail') trend = 'broken'
      else if (to === 'unknown') trend = 'undecidable'
    } else if (to === 'fail' && then.failed !== now.failed) {
      trend = 'moved'
    }
    if (!trend) continue

    changes.push({
      ruleId: now.ruleId,
      titleDe: now.titleDe,
      richtlinie: now.richtlinie,
      trend,
      before: { passed: then.passed, failed: then.failed, undecidable: then.undecidable },
      after: { passed: now.passed, failed: now.failed, undecidable: now.undecidable },
    })
  }

  const order: Record<BimComplianceTrend, number> = {
    broken: 0,
    undecidable: 1,
    moved: 2,
    decidable: 3,
    resolved: 4,
  }
  return changes.sort(
    (a, b) => order[a.trend] - order[b.trend] || a.ruleId.localeCompare(b.ruleId)
  )
}

const TREND_DE: Record<BimComplianceTrend, string> = {
  broken: 'neu nicht erfüllt',
  undecidable: 'nicht mehr entscheidbar (Wert im Modell entfallen)',
  moved: 'weiterhin nicht erfüllt, andere Anzahl',
  decidable: 'jetzt entscheidbar und erfüllt',
  resolved: 'jetzt erfüllt',
}

export function renderBimComplianceDiff(changes: readonly BimComplianceChange[]): string {
  if (changes.length === 0) {
    return 'Keine Anforderung hat ihren Status zwischen diesen beiden Ständen geändert.'
  }
  return changes
    .map(
      (change) =>
        `${change.richtlinie} — ${change.titleDe}: ${TREND_DE[change.trend]} ` +
        `(${change.before.passed}/${change.before.failed}/${change.before.undecidable} → ` +
        `${change.after.passed}/${change.after.failed}/${change.after.undecidable} ` +
        'erfüllt/nicht erfüllt/nicht entscheidbar)'
    )
    .join('\n')
}

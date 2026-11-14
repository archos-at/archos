/**
 * Regression across revisions: how each rule's standing moved between two
 * revisions of one model, judged with the same facts. Pure. Split from
 * `rules.ts` (the catalog), which re-exports it.
 */

import type { BimRuleResult } from './rules'

/** How a rule's standing moved between two revisions. */
export type BimComplianceTrend =
  /** Was failing (or undecidable), now passes. */
  | 'resolved'
  /** Was passing, now fails — the answer nobody gets today. */
  | 'broken'
  /** Became decidable: the model gained the property. */
  | 'decidable'
  /** Stopped being decidable: the model LOST the property. */
  | 'undecidable'
  /** Still failing, but a different number of elements. */
  | 'moved'

export interface BimComplianceChange {
  ruleId: string
  titleDe: string
  richtlinie: string
  trend: BimComplianceTrend
  before: { passed: number; failed: number; undecidable: number }
  after: { passed: number; failed: number; undecidable: number }
}

/** The verdict a rule's counts amount to, for trend purposes. */
function standing(result: BimRuleResult): 'pass' | 'fail' | 'unknown' | 'empty' {
  if (!result.applicable) return 'empty'
  if (result.failed > 0) return 'fail'
  if (result.passed === 0 && result.undecidable === 0) return 'empty'
  // ANY undecidable element leaves the rule unsettled, not passing. The
  // alternative reads a revision that dropped `FireRating` from half its walls
  // as "no change" — the rule stood at `pass` with 40 passed, and it still
  // stands at `pass` with 20 passed and 20 undecidable. That regression is
  // precisely what a diff is for, and it is the same unearned tick
  // `summarizeBimRules` refuses to show on the page.
  if (result.undecidable > 0) return 'unknown'
  return 'pass'
}

/**
 * What a new revision changed about the building's standing.
 *
 * This is the payoff of having verdicts at all. "188 Bauteile, +17" says a
 * revision happened; **"Treppe Ost erfüllt das Steigungsverhältnis nicht
 * mehr"** says what it did — and that is the sentence an architect cannot get
 * from any tool at a price a small office would pay.
 *
 * `undecidable` as a trend is deliberately reported and not swallowed: a
 * revision that DROPS a property (a re-export with a different mapping, a
 * Pset that stopped being written) silently un-checks a requirement that was
 * green yesterday. Reporting only pass↔fail would let that pass unnoticed,
 * which is the same silence the whole subsystem exists to break.
 *
 * Rules whose standing did not change are omitted — a change list that
 * restates everything is a list nobody reads.
 */
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
      // Same verdict, different scale. Worth surfacing: nine failing doors
      // becoming two is progress, and becoming ninety is a regression, and
      // neither shows up in a pass/fail comparison.
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

  // Regressions first: what a revision BROKE is the reason to read this list.
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

/**
 * The agent's wording for a status change.
 *
 * A second copy of `complianceDiff.trend.*` in the dictionaries, and it had
 * already drifted: this one says "nicht mehr entscheidbar (Wert im Modell
 * entfallen)" where the badge says only "nicht mehr entscheidbar", so the
 * chip and the sentence beside it described the same change differently.
 *
 * It stays a copy rather than reading the dictionary, because this module is
 * server-side and locale-free — it renders one German string for the agent,
 * which has no `useTranslations` and no locale to read. The parenthetical is
 * the better wording and has been carried into the dictionary; if either side
 * changes, change both.
 */
const TREND_DE: Record<BimComplianceTrend, string> = {
  broken: 'neu nicht erfüllt',
  undecidable: 'nicht mehr entscheidbar (Wert im Modell entfallen)',
  moved: 'weiterhin nicht erfüllt, andere Anzahl',
  decidable: 'jetzt entscheidbar und erfüllt',
  resolved: 'jetzt erfüllt',
}

/** German lines for the agent, regressions first. */
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

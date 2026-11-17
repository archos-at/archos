import type { BimRuleResult } from './rule-types'

export function renderBimRules(results: readonly BimRuleResult[]): string {
  const lines = results.map((result) => {
    const head = `${result.richtlinie} ${result.clause} — ${result.titleDe}`
    if (!result.applicable) return `${head}: nicht einschlägig (${result.notApplicableReason})`
    const checked = result.passed + result.failed + result.undecidable
    if (checked === 0) return `${head}: keine betroffenen Bauteile im Modell`
    if (result.hint) return `${head}: ${result.hint}; ${checked} Bauteile gelesen, keines beurteilt (${result.thresholdDe})`
    return (
      `${head}: ${result.passed} erfüllt, ${result.failed} nicht erfüllt, ` +
      `${result.undecidable} nicht entscheidbar (${result.thresholdDe})`
    )
  })
  lines.push(
    'Orientierende Prüfung anhand der im Modell veröffentlichten Werte — keine Rechtsauskunft ' +
      'und kein Nachweis. „Nicht entscheidbar“ heißt: das Modell führt den Wert nicht.'
  )
  return lines.join('\n')
}

/**
 * Whether a model-check rule may give a verdict at the project's site, from
 * the knowledge context the turn reads (country-as-data §5, "Rules evaluated
 * per binding edition" and "Hint instead of verdict"). A rule's thresholds
 * come from one edition of one work, named as the records name them. A pass
 * or a fail holds only where that edition binds at the site, the gate is
 * settled (`core`, `full`) and the edition's scope does not wait on a fact
 * (`check`). Where the work has no use at the site at all, on a settled gate,
 * the rule does not apply. Everywhere else the rule is a hint: its readings
 * are shown, nothing is decided. Nothing here names a country. Pure.
 */

import type { ContextUse, KnowledgeContext } from '@/lib/base-knowledge/context/wire'

/** A rule's source: the work's designation and the edition's label, as the records hold them. */
export interface RuleEdition {
  designation: string
  edition: string
}

export type RuleBasis = { kind: 'verdict' } | { kind: 'hint'; reason: string } | { kind: 'outside'; reason: string }

const SETTLED = new Set(['core', 'full'])

const hint = (reason: string): RuleBasis => ({ kind: 'hint', reason: `Hinweis: ${reason}` })

const routeOf = (use: ContextUse) =>
  use.route?.designation ? ` über ${[use.route.designation, use.route.editionLabel].filter(Boolean).join(' ')}` : ''

/** The basis of one rule in a context; no context is a site nobody placed. */
export function ruleBasis(rule: RuleEdition, context: KnowledgeContext | null): RuleBasis {
  const source = `${rule.designation}, ${rule.edition}`
  const gate = context?.gate.state ?? 'site_unknown'
  if (!context || gate === 'site_unknown') return hint(`Standort des Projekts unbekannt — ob ${rule.designation} dort gilt, ist offen`)
  if (!SETTLED.has(gate)) return hint(`für den Standort sind keine geprüften Grundlagen veröffentlicht — Schwellwerte aus ${source}`)
  const uses = context.uses.filter((use) => use.designation === rule.designation)
  const binding = uses.filter((use) => use.role === 'binding')
  if (binding.length === 0) {
    if (uses.length === 0 && (context.undetermined ?? []).length === 0) {
      return { kind: 'outside', reason: `${rule.designation} gilt am Standort des Projekts nicht` }
    }
    return hint(`am Standort ist keine Ausgabe von ${rule.designation} als verbindlich bestimmt — Schwellwerte aus ${source}`)
  }
  const same = binding.find((use) => use.editionLabel === rule.edition)
  if (!same) {
    const other = binding[0]
    return hint(`Schwellwerte aus ${rule.edition}; am Standort gilt ${other.editionLabel ?? 'eine andere Ausgabe'}${routeOf(other)}`)
  }
  if (same.applicability?.verdict === 'check') return hint(`ob ${source} für die Gebäude des Projekts gilt, ist offen`)
  return { kind: 'verdict' }
}

/** Every rule's basis, by rule id. */
export function ruleBases(rules: readonly (RuleEdition & { id: string })[], context: KnowledgeContext | null): Record<string, RuleBasis> {
  return Object.fromEntries(rules.map((rule) => [rule.id, ruleBasis(rule, context)]))
}

/** The bases as a cache-key segment: the same bases, the same verdicts. */
export const basisKey = (bases: Readonly<Record<string, RuleBasis>>): string =>
  Object.entries(bases)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, basis]) => `${id}:${basis.kind}${'reason' in basis ? `:${basis.reason}` : ''}`)
    .join(';')

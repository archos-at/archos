/**
 * Whether a model-check rule may give a verdict at the project's site, from
 * the knowledge context the turn reads (country-as-data §5, "Rules evaluated
 * per binding edition" and "Hint instead of verdict"). A rule's thresholds
 * come from one edition of one work, named as the records name them. A pass
 * or a fail holds only where every binding use of that work at the site is
 * that edition, the gate is settled (`core`, `full`) and the edition's scope
 * does not wait on a fact (`check`). Everywhere else the rule is a hint: its
 * readings are shown, nothing is decided. A work with no binding use is a
 * hint too, never "not applicable": the context holds no positive sign that a
 * work does not apply, and a renamed designation must not silence a rule.
 * Nothing here names a country. Pure.
 */

import { MAX_CONTEXT_USES, type ContextUse, type KnowledgeContext } from '@/lib/base-knowledge/context/wire'
import type { GateState } from '@/lib/base-knowledge/wire/vocab'

/** A rule's source: the work's designation and the edition's label, as the records hold them. */
export interface RuleEdition {
  designation: string
  edition: string
}

export type RuleBasis = { kind: 'verdict' } | { kind: 'hint'; reason: string }

/**
 * Why an unsettled gate gives no verdict, one reason per state, worded after
 * the profile's law card (`intakeProfileStep.rules.gate`). A failed read says
 * so and never that nothing is published.
 */
const UNSETTLED: Record<Exclude<GateState, 'core' | 'full'>, (designation: string) => string> = {
  site_unknown: (designation) => `Standort des Projekts unbekannt — ob ${designation} dort gilt, ist offen`,
  organization_unplaced: () => 'Ihr Büro hat noch kein Land, daher ist offen, welches Recht am Standort gilt',
  not_entitled: () => 'das Recht am Standort ist für Ihr Büro nicht freigeschaltet',
  knowledge_unavailable: () => 'das geltende Recht konnte gerade nicht gelesen werden',
  none: () => 'für den Standort ist noch kein Recht erfasst',
  open: () => 'für den Standort sind keine geprüften Grundlagen veröffentlicht',
}

const hint = (reason: string): RuleBasis => ({ kind: 'hint', reason: `Hinweis: ${reason}` })

const routeOf = (use: ContextUse) =>
  use.route?.designation ? ` über ${[use.route.designation, use.route.editionLabel].filter(Boolean).join(' ')}` : ''

/** The basis of one rule in a context; no context is a site nobody placed. */
export function ruleBasis(rule: RuleEdition, context: KnowledgeContext | null): RuleBasis {
  const source = `${rule.designation}, ${rule.edition}`
  const unsettled = (gate: keyof typeof UNSETTLED) =>
    hint(gate === 'site_unknown' ? UNSETTLED[gate](rule.designation) : `${UNSETTLED[gate](rule.designation)} — Schwellwerte aus ${source}`)
  if (!context) return unsettled('site_unknown')
  const gate = context.gate.state
  if (gate !== 'core' && gate !== 'full') return unsettled(gate)
  // A full list may have cut a second binding edition of this work: no verdict on part of the law.
  if (context.uses.length >= MAX_CONTEXT_USES) return hint(`am Standort gilt mehr Recht, als hier gelesen wurde, daher kein Urteil — Schwellwerte aus ${source}`)
  const binding = context.uses.filter((use) => use.designation === rule.designation && use.role === 'binding')
  if (binding.length === 0) {
    return hint(`${rule.designation} ist am Standort nicht als verbindlich ausgewiesen, daher kein Urteil — Schwellwerte aus ${source}`)
  }
  const other = binding.find((use) => use.editionLabel !== rule.edition)
  if (other) {
    return hint(`Schwellwerte aus ${rule.edition}; am Standort gilt ${other.editionLabel ?? 'eine andere Ausgabe'}${routeOf(other)}`)
  }
  if (binding.some((use) => use.applicability?.verdict === 'check')) return hint(`ob ${source} für die Gebäude des Projekts gilt, ist offen`)
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

import { MAX_CONTEXT_USES, type ContextUse, type KnowledgeContext } from '@/lib/base-knowledge/context/wire'
import type { GateState } from '@/lib/base-knowledge/wire/vocab'

export interface RuleEdition {
  designation: string
  edition: string
}

export type RuleBasis = { kind: 'verdict' } | { kind: 'hint'; reason: string }

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

export function ruleBasis(rule: RuleEdition, context: KnowledgeContext | null): RuleBasis {
  const source = `${rule.designation}, ${rule.edition}`
  const unsettled = (gate: keyof typeof UNSETTLED) =>
    hint(gate === 'site_unknown' ? UNSETTLED[gate](rule.designation) : `${UNSETTLED[gate](rule.designation)} — Schwellwerte aus ${source}`)
  if (!context) return unsettled('site_unknown')
  const gate = context.gate.state
  if (gate !== 'core' && gate !== 'full') return unsettled(gate)
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

export function ruleBases(rules: readonly (RuleEdition & { id: string })[], context: KnowledgeContext | null): Record<string, RuleBasis> {
  return Object.fromEntries(rules.map((rule) => [rule.id, ruleBasis(rule, context)]))
}

export const basisKey = (bases: Readonly<Record<string, RuleBasis>>): string =>
  Object.entries(bases)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, basis]) => `${id}:${basis.kind}${'reason' in basis ? `:${basis.reason}` : ''}`)
    .join(';')

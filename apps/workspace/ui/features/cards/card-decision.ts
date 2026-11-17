import type { AnswerCard } from '@/shared/cards/schemas'

export type CardInteractivity =
  | 'interactive'
  | 'live'
  | 'presentational'

export const CARD_INTERACTIVITY: Record<AnswerCard['type'], CardInteractivity> = {
  project_profile_patch: 'interactive',
  memory_proposal: 'interactive',
  file_operation_proposal: 'interactive',
  operation_proposal: 'interactive',
  canvas_activity: 'live',

  calculation: 'presentational',
  formula: 'presentational',
  look: 'presentational',
  revision_compare: 'presentational',
  document_grid: 'presentational',
  document_draft: 'interactive',
  task_created: 'presentational',
  building_section: 'presentational',
  stair_diagram: 'presentational',
  dimension_diagram: 'presentational',
  setback_plan: 'presentational',
  egress_diagram: 'presentational',
  daylight_incidence: 'presentational',
  guardrail_check: 'presentational',
  fire_access_plan: 'presentational',
  ifc_viewer: 'presentational',
  ifc_schedule: 'presentational',
  ifc_element: 'presentational',
  ifc_diff: 'presentational',
  ifc_compliance: 'presentational',
  ifc_model_picker: 'presentational',
  surface: 'presentational',
}

const typesClassifiedAs = (kind: CardInteractivity): Array<AnswerCard['type']> =>
  Object.entries(CARD_INTERACTIVITY)
    .filter(([, classified]) => classified === kind)
    .map(([type]) => type) as Array<AnswerCard['type']>

export const INTERACTIVE_CARD_TYPES = typesClassifiedAs('interactive')

export const LIVE_CARD_TYPES = typesClassifiedAs('live')

export const isInteractiveCardType = (type: AnswerCard['type']): boolean =>
  CARD_INTERACTIVITY[type] === 'interactive'

export const isLiveCardType = (type: AnswerCard['type']): boolean => CARD_INTERACTIVITY[type] === 'live'

export const ACTING_CARD_TYPES = [...INTERACTIVE_CARD_TYPES, ...LIVE_CARD_TYPES]

export const CARD_DECISIONS = [
  'accepted',
  'rejected',
  'savedOrg',
  'savedProject',
  'dismissed',
  'partiallyApplied',
  'filed',
  'submitted',
] as const

export type CardDecision = (typeof CARD_DECISIONS)[number]

export interface CardInteraction {
  decision: CardDecision
  decidedAt: string
}

export type CardInteractions = Record<string, CardInteraction>

export const cardKey = (card: Pick<AnswerCard, 'type'>, index: number): string =>
  `${card.type}-${index}`

export const itemDecisionKey = (key: string, itemId: string): string => `${key}#${itemId}`

export const cardKeyOfDecisionKey = (key: string): string => {
  const hash = key.indexOf('#')
  return hash === -1 ? key : key.slice(0, hash)
}

const DECISIONS: ReadonlySet<string> = new Set(CARD_DECISIONS)

export const isCardDecision = (value: unknown): value is CardDecision =>
  typeof value === 'string' && DECISIONS.has(value)

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && UTC_INSTANT.test(value) && !Number.isNaN(Date.parse(value))

export const reconcileCardInteractions = (
  interactions: CardInteractions | undefined,
  previousCards: ReadonlyArray<AnswerCard | undefined> | undefined,
  nextCards: ReadonlyArray<AnswerCard | undefined> | undefined
): CardInteractions | undefined => {
  if (!interactions) return undefined

  const survivors = new Set<string>()
  ;(nextCards ?? []).forEach((card, index) => {
    if (!card) return
    const previous = previousCards?.[index]
    if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(card)) {
      survivors.add(cardKey(card, index))
    }
  })

  const kept = Object.entries(interactions).filter(([key]) => survivors.has(cardKeyOfDecisionKey(key)))
  return kept.length > 0 ? Object.fromEntries(kept) : undefined
}

export const sanitizeCardInteractions = (raw: unknown): CardInteractions | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined

  const clean: CardInteractions = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const { decision, decidedAt } = value as { decision?: unknown; decidedAt?: unknown }
    if (!isCardDecision(decision)) continue
    clean[key] = {
      decision,
      decidedAt: isTimestamp(decidedAt) ? decidedAt : new Date(0).toISOString(),
    }
  }

  return Object.keys(clean).length > 0 ? clean : undefined
}

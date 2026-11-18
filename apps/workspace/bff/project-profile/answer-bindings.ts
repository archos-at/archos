import { PROJECT_KEYS, type ProjectKey } from '@/lib/text/answer-directives'
import { flattenIntakeQuestions } from './intake-conditions'
import { projectIntakeDefinitionV1 } from './intake-definition'
import { formatIntakeAnswer } from './intake-vocabulary'
import type { ProjectIntakeQuestion } from './intake-types'
import { ProjectProfileSchema } from './types'
import type { ProjectPrimitiveValue, ProjectProfile } from './types'

export type BoundFactState = 'confirmed' | 'assumed' | 'missing'

export interface BoundFact {
  key: ProjectKey
  state: BoundFactState
  text: string | null
  number: number | null
  reason?: string
  updatedAt?: string
}

export type ProjectFactResolver = (key: ProjectKey) => BoundFact

const UNITS: Partial<Record<ProjectKey, string>> = {
  escape_level_m: 'm',
  gross_floor_area_m2: 'm²',
}

export const unitFor = (key: ProjectKey): string | undefined => UNITS[key]

const FIGURES = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })

export const formatFigure = (value: number, unit?: string): string =>
  unit ? `${FIGURES.format(value)} ${unit}` : FIGURES.format(value)

function questionFor(factKey: string): ProjectIntakeQuestion | undefined {
  return flattenIntakeQuestions(projectIntakeDefinitionV1).find(
    (question) => question.writesTo?.match(/^\/facts\/([^/]+)/)?.[1] === factKey
  )
}

export function buildingClassNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value !== 'string') return null
  const match = /^(?:gk|gebäudeklasse|geb[aä]udeklasse)?\s*([1-5])$/i.exec(value.trim())
  return match ? Number(match[1]) : null
}

function display(key: ProjectKey, value: ProjectPrimitiveValue): { text: string; number: number | null } | null {
  if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null
  if (key === 'building_class') {
    const number = buildingClassNumber(value)
    return number === null ? { text: String(value), number: null } : { text: `GK ${number}`, number }
  }
  if (typeof value === 'number') return { text: formatFigure(value, UNITS[key]), number: value }
  const question = questionFor(PROJECT_KEYS[key])
  const text = question ? formatIntakeAnswer(question, value) : Array.isArray(value) ? value.join(', ') : String(value)
  return text && text !== '—' ? { text, number: null } : null
}

function entryFor<T>(record: Record<string, T>, factKey: string): T | undefined {
  if (record[factKey] !== undefined) return record[factKey]
  const scoped = Object.keys(record)
    .filter((name) => name.split('@')[0] === factKey)
    .sort()[0]
  return scoped === undefined ? undefined : record[scoped]
}

export function bindProjectFact(profile: ProjectProfile | null | undefined, key: ProjectKey): BoundFact {
  const factKey = PROJECT_KEYS[key]
  const fact = profile ? entryFor(profile.facts, factKey) : undefined
  const shown = fact ? display(key, fact.value) : null
  if (fact && shown) return { key, state: 'confirmed', ...shown, updatedAt: fact.updatedAt }
  const assumption = profile ? entryFor(profile.assumptions, factKey) : undefined
  const assumed = assumption ? display(key, assumption.value) : null
  if (assumption && assumed) {
    return { key, state: 'assumed', ...assumed, reason: assumption.reason, updatedAt: assumption.updatedAt }
  }
  return { key, state: 'missing', text: null, number: null }
}

export function projectFactResolver(rawProfile: unknown): ProjectFactResolver {
  const parsed = ProjectProfileSchema.safeParse(rawProfile ?? {})
  const profile = parsed.success ? parsed.data : null
  const cache = new Map<ProjectKey, BoundFact>()
  return (key) => {
    const known = cache.get(key)
    if (known) return known
    const bound = bindProjectFact(profile, key)
    cache.set(key, bound)
    return bound
  }
}

import type { BimHighlightSpec } from '../hooks/use-bim-model'
import type { BimHighlightStatus } from './model-index'

const STATUSES: readonly BimHighlightStatus[] = ['pass', 'fail', 'warning', 'info']

interface PropertyMatchPayload {
  name?: unknown
  set?: unknown
  operator?: unknown
  value?: unknown
  source?: unknown
}

export interface HighlightPayload {
  global_ids?: unknown
  match?: unknown
  label?: unknown
  status?: unknown
}

const OPERATORS = ['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'exists', 'missing'] as const
const SOURCES = ['property', 'quantity'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const strings = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  return strings.length > 0 ? strings : undefined
}

const nonEmpty = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | undefined =>
  allowed.find((candidate) => candidate === value)

const either = (raw: Record<string, unknown>, snake: string, camel: string): unknown =>
  raw[snake] !== undefined ? raw[snake] : raw[camel]

function propertyFilter(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null
  const name = nonEmpty(raw.name)
  if (!name) return null
  const filter: Record<string, unknown> = { name }
  const set = nonEmpty((raw as PropertyMatchPayload).set)
  if (set) filter.set = set
  const operator = oneOf(OPERATORS, raw.operator)
  if (operator) filter.operator = operator
  if (typeof raw.value === 'string' || typeof raw.value === 'number' || typeof raw.value === 'boolean') {
    filter.value = raw.value
  }
  const source = oneOf(SOURCES, raw.source)
  if (source) filter.source = source
  return filter
}

export function matchToFilter(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null
  const filter: Record<string, unknown> = {}

  const ifcTypes = stringList(either(raw, 'ifc_types', 'ifcTypes'))
  if (ifcTypes) filter.ifcTypes = ifcTypes
  const storeys = stringList(raw.storeys)
  if (storeys) filter.storeys = storeys
  const nameContains = nonEmpty(either(raw, 'name_contains', 'nameContains'))
  if (nameContains) filter.nameContains = nameContains
  const material = nonEmpty(raw.material)
  if (material) filter.material = material
  const classification = nonEmpty(raw.classification)
  if (classification) filter.classification = classification

  if (Array.isArray(raw.properties)) {
    const properties = raw.properties.map(propertyFilter).filter((entry): entry is Record<string, unknown> => entry !== null)
    if (properties.length > 0) filter.properties = properties
  }

  return Object.keys(filter).length > 0 ? filter : null
}

export function cardHighlightSpecs(payload: readonly HighlightPayload[]): BimHighlightSpec[] {
  const specs: BimHighlightSpec[] = []
  for (const group of payload) {
    const label = nonEmpty(group.label)
    if (!label) continue
    const status = STATUSES.find((candidate) => candidate === group.status) ?? 'info'
    const globalIds = stringList(group.global_ids)
    if (globalIds) {
      specs.push({ globalIds, label, status })
      continue
    }
    const match = matchToFilter(group.match)
    if (match) specs.push({ match, label, status })
  }
  return specs
}

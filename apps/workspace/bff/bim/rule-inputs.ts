import type { BimElement, BimPropertySets, BimQuantitySets } from './types'

export const RULE_INPUT_FIELDS: readonly string[] = [
  'globalId',
  'ifcType',
  'name',
  'storeyName',
  'predefinedType',
  'properties',
  'quantities',
]

export const RULE_INPUT_KEYS: readonly string[] = [
  'AcousticRating',
  'ClearHeight',
  'ClearWidth',
  'FinishCeilingHeight',
  'FireRating',
  'Height',
  'IsExternal',
  'LoadBearing',
  'OverallWidth',
  'RiserHeight',
  'ThermalTransmittance',
  'TreadLength',
  'Width',
]

const WANTED = new Set(RULE_INPUT_KEYS.map((key) => key.toLowerCase()))

function prune<T extends BimPropertySets | BimQuantitySets>(sets: T): T {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [setName, values] of Object.entries(sets)) {
    let kept: Record<string, unknown> | undefined
    for (const [key, value] of Object.entries(values)) {
      if (!WANTED.has(key.toLowerCase())) continue
      kept ??= {}
      kept[key] = value
    }
    if (kept) out[setName] = kept
  }
  return out as T
}

interface CompactElement {
  g: string
  t: string
  n?: string
  s?: string
  d?: string
  p?: BimPropertySets
  q?: BimQuantitySets
}

const hasEntries = (sets: BimPropertySets | BimQuantitySets): boolean =>
  Object.keys(sets).length > 0

export function projectRuleInputs(elements: readonly BimElement[]): CompactElement[] {
  return elements.map((element) => {
    const properties = prune(element.properties)
    const quantities = prune(element.quantities)
    const compact: CompactElement = { g: element.globalId, t: element.ifcType }
    if (element.name !== null) compact.n = element.name
    if (element.storeyName !== null) compact.s = element.storeyName
    if (element.predefinedType !== null) compact.d = element.predefinedType
    if (hasEntries(properties)) compact.p = properties
    if (hasEntries(quantities)) compact.q = quantities
    return compact
  })
}

function rehydrate(compact: CompactElement): BimElement {
  return {
    globalId: compact.g,
    expressId: 0,
    ifcType: compact.t,
    name: compact.n ?? null,
    description: null,
    predefinedType: compact.d ?? null,
    objectType: null,
    tag: null,
    typeName: null,
    storeyGlobalId: null,
    storeyName: compact.s ?? null,
    containerGlobalId: null,
    containerKind: null,
    containerName: null,
    materials: [],
    classifications: [],
    properties: compact.p ?? {},
    quantities: compact.q ?? {},
  }
}

export interface StoredRuleInputs {
  version: number
  truncated: boolean
  elements: CompactElement[]
}

export const RULE_INPUTS_VERSION = 1

export function buildStoredRuleInputs(
  elements: readonly BimElement[],
  truncated: boolean
): StoredRuleInputs {
  return { version: RULE_INPUTS_VERSION, truncated, elements: projectRuleInputs(elements) }
}

export function readStoredRuleInputs(
  raw: unknown
): { truncated: boolean; elements: BimElement[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<StoredRuleInputs>
  if (value.version !== RULE_INPUTS_VERSION) return null
  if (!Array.isArray(value.elements)) return null
  return { truncated: value.truncated === true, elements: value.elements.map(rehydrate) }
}

const EXPONENT_FORM = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i

function renderScalar(raw: unknown): string {
  const text = String(raw)
  if (typeof raw !== 'number') return text
  const match = EXPONENT_FORM.exec(text)
  if (!match) return text

  const [, sign, whole, fraction = '', exponent] = match
  const digits = whole + fraction
  const point = whole.length + Number(exponent)
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

export function buildSearchKeys(element: BimElement): Record<string, string[]> {
  const keys = new Map<string, Set<string>>()
  const ensure = (key: string): Set<string> => {
    const bucket = keys.get(key) ?? new Set<string>()
    keys.set(key, bucket)
    return bucket
  }

  for (const [prefix, sets] of [
    ['p:', element.properties],
    ['q:', element.quantities],
  ] as const) {
    for (const [setName, values] of Object.entries(sets)) {
      for (const [name, raw] of Object.entries(values)) {
        const bare = ensure(`${prefix}${name.toLowerCase()}`)
        const qualified = ensure(`${prefix}${setName.toLowerCase()}.${name.toLowerCase()}`)
        if (raw === null || raw === undefined) continue
        const value = renderScalar(raw).toLowerCase()
        bare.add(value)
        qualified.add(value)
      }
    }
  }
  return Object.fromEntries([...keys].map(([key, values]) => [key, [...values]]))
}

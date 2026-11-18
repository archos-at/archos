import type { BimElement } from './types'

export interface BimFieldChange {
  field: string
  before: string | number | boolean | null
  after: string | number | boolean | null
  delta: number | null
}

export interface BimChangedElement {
  globalId: string
  ifcType: string
  name: string | null
  storeyName: string | null
  changes: BimFieldChange[]
}

export interface BimElementRef {
  globalId: string
  ifcType: string
  name: string | null
  storeyName: string | null
}

export interface BimComparison {
  added: BimElementRef[]
  removed: BimElementRef[]
  changed: BimChangedElement[]
  unchangedCount: number
  counts: { added: number; removed: number; changed: number }
  totals: { base: number; revision: number }
  truncated: boolean
}

export const MAX_COMPARISON_ROWS = 500

function ref(element: BimElement): BimElementRef {
  return {
    globalId: element.globalId,
    ifcType: element.ifcType,
    name: element.name,
    storeyName: element.storeyName,
  }
}

function flatten(element: BimElement): Map<string, string | number | boolean | null> {
  const flat = new Map<string, string | number | boolean | null>()
  for (const [setName, properties] of Object.entries(element.properties)) {
    for (const [name, value] of Object.entries(properties)) flat.set(`${setName}.${name}`, value)
  }
  for (const [setName, quantities] of Object.entries(element.quantities)) {
    for (const [name, value] of Object.entries(quantities)) flat.set(`${setName}.${name}`, value)
  }
  return flat
}

function numericDelta(
  before: string | number | boolean | null,
  after: string | number | boolean | null
): number | null {
  if (typeof before !== 'number' || typeof after !== 'number') return null
  return Math.round((after - before) * 10_000) / 10_000
}

const IDENTITY_FIELDS: Array<{ field: string; read: (element: BimElement) => string | null }> = [
  { field: 'ifcType', read: (element) => element.ifcType },
  { field: 'name', read: (element) => element.name },
  { field: 'storey', read: (element) => element.storeyName },
  { field: 'predefinedType', read: (element) => element.predefinedType },
  { field: 'typeName', read: (element) => element.typeName },
  { field: 'materials', read: (element) => (element.materials.length ? element.materials.join(', ') : null) },
]

function diffElement(before: BimElement, after: BimElement): BimFieldChange[] {
  const changes: BimFieldChange[] = []

  for (const { field, read } of IDENTITY_FIELDS) {
    const from = read(before)
    const to = read(after)
    if (from !== to) changes.push({ field, before: from, after: to, delta: null })
  }

  const beforeFlat = flatten(before)
  const afterFlat = flatten(after)
  const keys = new Set([...beforeFlat.keys(), ...afterFlat.keys()])
  for (const key of [...keys].sort()) {
    const from = beforeFlat.has(key) ? (beforeFlat.get(key) ?? null) : null
    const to = afterFlat.has(key) ? (afterFlat.get(key) ?? null) : null
    if (from === to) continue
    changes.push({ field: key, before: from, after: to, delta: numericDelta(from, to) })
  }

  return changes
}

export function compareModels(input: {
  base: readonly BimElement[]
  revision: readonly BimElement[]
  truncated?: boolean
}): BimComparison {
  const baseById = new Map(input.base.map((element) => [element.globalId, element]))
  const revisionById = new Map(input.revision.map((element) => [element.globalId, element]))

  const added: BimElementRef[] = []
  const removed: BimElementRef[] = []
  const changed: BimChangedElement[] = []
  let unchangedCount = 0

  for (const element of input.revision) {
    const previous = baseById.get(element.globalId)
    if (!previous) {
      added.push(ref(element))
      continue
    }
    const changes = diffElement(previous, element)
    if (changes.length === 0) {
      unchangedCount += 1
      continue
    }
    changed.push({ ...ref(element), changes })
  }

  for (const element of input.base) {
    if (!revisionById.has(element.globalId)) removed.push(ref(element))
  }

  const byType = (a: BimElementRef, b: BimElementRef) =>
    a.ifcType === b.ifcType
      ? (a.name ?? '').localeCompare(b.name ?? '')
      : a.ifcType.localeCompare(b.ifcType)

  return {
    counts: { added: added.length, removed: removed.length, changed: changed.length },
    added: added.sort(byType).slice(0, MAX_COMPARISON_ROWS),
    removed: removed.sort(byType).slice(0, MAX_COMPARISON_ROWS),
    changed: changed
      .sort((a, b) => b.changes.length - a.changes.length)
      .slice(0, MAX_COMPARISON_ROWS),
    unchangedCount,
    totals: { base: input.base.length, revision: input.revision.length },
    truncated: input.truncated ?? false,
  }
}

export function renderComparison(comparison: BimComparison): string {
  const { counts, unchangedCount } = comparison
  const truncated = comparison.truncated
    ? ' Achtung: mindestens ein Stand ist gekürzt indiziert, der Vergleich kann unvollständig sein.'
    : ''

  if (counts.added === 0 && counts.removed === 0 && counts.changed === 0) {
    return `Keine Unterschiede: beide Stände enthalten dieselben ${unchangedCount} Bauteile mit gleichen Werten.${truncated}`
  }
  const parts = [
    `${counts.added} neu`,
    `${counts.removed} entfallen`,
    `${counts.changed} geändert`,
    `${unchangedCount} unverändert`,
  ]
  return `Vergleich: ${parts.join(', ')}.${truncated}`
}

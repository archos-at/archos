import type { ContextUse } from '../context/wire'
import { designationKey } from '../platform'
import type { StoredEntry } from '../store/repository'
import type { BindingStanding } from '../wire'

export interface BindingNorm {
  editionLabel: string
  startsOn: string | null
  via: BindingStanding['via']
}

export type BindingNorms = ReadonlyMap<string, readonly BindingNorm[]>

export const NO_BINDING_NORMS: BindingNorms = new Map()

export type BindingOnDay =
  | { status: 'held'; entry: StoredEntry; norm: BindingNorm }
  | { status: 'other'; norm: BindingNorm }
  | { status: 'unknown' }

type BindingUse = Pick<ContextUse, 'role' | 'via' | 'editionId' | 'designation' | 'editionLabel' | 'route'>

const ISO_DAYS = /\d{4}-\d{2}-\d{2}/g

const firstDay = (label: string): string | null => label.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null

const labelKey = (label: string) => label.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim()

function daysOf(label: string, ...days: (string | null)[]): Set<string> {
  return new Set([...days.filter((day): day is string => day !== null), ...(label.match(ISO_DAYS) ?? [])])
}

export function bindingNormsOf(uses: readonly BindingUse[]): BindingNorms {
  const norms = new Map<string, BindingNorm[]>()
  for (const use of uses) {
    if (use.role !== 'binding' || use.via !== 'relation' || !use.editionId || !use.designation || !use.editionLabel) continue
    const key = designationKey(use.designation)
    const via = use.route ? { designation: use.route.designation, editionLabel: use.route.editionLabel } : null
    norms.set(key, [...(norms.get(key) ?? []), { editionLabel: use.editionLabel, startsOn: firstDay(use.editionLabel), via }])
  }
  return norms
}

export function isSameEdition(entry: StoredEntry, norm: BindingNorm): boolean {
  if (labelKey(entry.values.editionLabel) === labelKey(norm.editionLabel)) return true
  const ours = daysOf(entry.values.editionLabel, entry.values.issuedOn, entry.values.inForceFrom)
  return [...daysOf(norm.editionLabel, norm.startsOn)].some((day) => ours.has(day))
}

const startOf = (entry: StoredEntry) => entry.values.inForceFrom ?? entry.values.issuedOn ?? firstDay(entry.values.editionLabel)

export function bindingOf(editions: readonly StoredEntry[], norms: readonly BindingNorm[] | undefined): BindingOnDay {
  const confirmed = editions.filter((entry) => entry.confirmed)
  if (!norms || norms.length === 0 || confirmed.length === 0) return { status: 'unknown' }
  for (const norm of norms) {
    const [entry] = confirmed.filter((candidate) => isSameEdition(candidate, norm)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    if (entry) return { status: 'held', entry, norm }
  }
  const [norm] = [...norms].sort((a, b) => (b.startsOn ?? '').localeCompare(a.startsOn ?? ''))
  return { status: 'other', norm }
}

export function bindingStanding(editions: readonly StoredEntry[], norms: readonly BindingNorm[] | undefined): BindingStanding | null {
  const found = bindingOf(editions, norms)
  if (found.status === 'unknown') return null
  const { editionLabel, startsOn, via } = found.norm
  const held = found.status === 'held'
  const starts = editions.filter((entry) => entry.confirmed).map(startOf)
  const newer = !held && startsOn !== null && starts.every((day) => day !== null && day < startsOn)
  return { editionLabel, startsOn, via, held, newer }
}

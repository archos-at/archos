import { BUILDING_ID_IN_KEY } from '@/lib/project-profile/intake-building-keys'
import {
  MAX_PROFILE_ALTERNATIVES,
  MAX_PROFILE_EVIDENCE,
  type ProfileAlternative,
  type ProfileEvidence,
} from '@/lib/project-profile/evidence-schema'
import type {
  ProjectAssumption,
  ProjectFact,
  ProjectPrimitiveValue,
  ProjectProfile,
  ProjectProfilePatchOperation,
} from '@/lib/project-profile/types'

export function profileKeyParts(key: string): { baseKey: string; buildingId: string | null } {
  const building = BUILDING_ID_IN_KEY.exec(key)
  return { baseKey: key.split('@')[0], buildingId: building ? building[1] : null }
}

export function sameProfileValue(a: ProjectPrimitiveValue, b: ProjectPrimitiveValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    const left = new Set(a)
    const right = new Set(b)
    return left.size === right.size && [...left].every((item) => right.has(item))
  }
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim()
  return a === b
}

export function isMeaningfulValue(value: ProjectPrimitiveValue): boolean {
  if (value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  return true
}

function sameEvidence(a: ProfileEvidence, b: ProfileEvidence): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function withEvidence(list: readonly ProfileEvidence[] | undefined, evidence: ProfileEvidence): ProfileEvidence[] {
  const current = [...(list ?? [])]
  if (current.some((entry) => sameEvidence(entry, evidence))) return current
  return current.length >= MAX_PROFILE_EVIDENCE ? current : [...current, evidence]
}

export function withAlternative(
  list: readonly ProfileAlternative[] | undefined,
  value: ProjectPrimitiveValue,
  evidence: ProfileEvidence,
  recordedAt: string
): ProfileAlternative[] {
  const current = [...(list ?? [])]
  const index = current.findIndex((alternative) => sameProfileValue(alternative.value, value))
  if (index >= 0) {
    current[index] = { ...current[index], evidence: withEvidence(current[index].evidence, evidence) }
    return current
  }
  if (current.length >= MAX_PROFILE_ALTERNATIVES) return current
  return [...current, { value, evidence: [evidence], recordedAt }]
}

export function withoutAlternative(list: readonly ProfileAlternative[] | undefined, index: number): ProfileAlternative[] {
  return (list ?? []).filter((_, position) => position !== index)
}

export function confirmedFact(value: ProjectPrimitiveValue, evidence: ProfileEvidence[], updatedAt: string): ProjectFact {
  return {
    value,
    confidence: 'confirmed',
    source: 'user_confirmed',
    updatedAt,
    ...(evidence.length > 0 ? { evidence: evidence.slice(0, MAX_PROFILE_EVIDENCE) } : {}),
  }
}

export function suggestedAssumption(
  value: ProjectPrimitiveValue,
  reason: string,
  evidence: ProfileEvidence[],
  updatedAt: string
): ProjectAssumption {
  return {
    value,
    status: 'unconfirmed',
    reason,
    source: 'agent_suggested',
    updatedAt,
    evidence: evidence.slice(0, MAX_PROFILE_EVIDENCE),
  }
}

export function pointerSegment(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1')
}

function tidy<T extends { evidence?: ProfileEvidence[]; alternatives?: ProfileAlternative[] }>(entry: T): T {
  const next = { ...entry }
  if (next.alternatives && next.alternatives.length === 0) delete next.alternatives
  return next
}

export function patchForKeys(
  before: ProjectProfile,
  after: ProjectProfile,
  keys: Iterable<string>
): ProjectProfilePatchOperation[] {
  const operations: ProjectProfilePatchOperation[] = []
  for (const key of new Set(keys)) {
    const segment = pointerSegment(key)
    operations.push(...entryOperation(`/facts/${segment}`, before.facts[key], after.facts[key]))
    operations.push(...entryOperation(`/assumptions/${segment}`, before.assumptions[key], after.assumptions[key]))
  }
  const unknownsChanged =
    before.unknowns.length !== after.unknowns.length ||
    before.unknowns.some((key, index) => after.unknowns[index] !== key)
  if (unknownsChanged) operations.push({ op: 'replace', path: '/unknowns', value: [...after.unknowns] })
  return operations
}

function entryOperation(
  path: string,
  before: ProjectFact | ProjectAssumption | undefined,
  after: ProjectFact | ProjectAssumption | undefined
): ProjectProfilePatchOperation[] {
  if (after) {
    return before && JSON.stringify(before) === JSON.stringify(after) ? [] : [{ op: 'add', path, value: tidy(after) }]
  }
  return before ? [{ op: 'remove', path }] : []
}

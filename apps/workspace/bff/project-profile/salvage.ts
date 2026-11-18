import { normalizeLegacyProfile } from './legacy-names'
import {
  ProjectAssumptionSchema,
  ProjectFactSchema,
  ProjectPrimitiveValueSchema,
  ProjectProfileSchema,
} from './types'
import type { ProjectAssumption, ProjectFact, ProjectPrimitiveValue, ProjectProfile } from './types'

export interface SalvageResult {
  profile: ProjectProfile | null
  dropped: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function salvageProjectProfile(stored: unknown): SalvageResult {
  const raw = normalizeLegacyProfile(stored)

  const full = ProjectProfileSchema.safeParse(raw)
  if (full.success) {
    return { profile: full.data, dropped: [] }
  }

  if (raw === null || raw === undefined) {
    return { profile: null, dropped: [] }
  }

  if (!isPlainObject(raw)) {
    return { profile: null, dropped: ['profile'] }
  }

  const dropped: string[] = []

  const facts = salvageRecord<ProjectFact>(raw.facts, ProjectFactSchema, 'facts', dropped)
  const assumptions = salvageRecord<ProjectAssumption>(
    raw.assumptions,
    ProjectAssumptionSchema,
    'assumptions',
    dropped
  )
  const goals = salvageGoals(raw.goals, dropped)
  const unknowns = salvageUnknowns(raw.unknowns, dropped)

  const anySalvaged =
    Object.keys(facts).length > 0 ||
    Object.keys(goals).length > 0 ||
    unknowns.length > 0 ||
    Object.keys(assumptions).length > 0

  if (!anySalvaged) {
    return { profile: null, dropped: dropped.length > 0 ? dropped : ['profile'] }
  }

  const profile: ProjectProfile = { facts, goals, unknowns, assumptions }
  return { profile, dropped }
}

export interface IntakeEntry {
  mode: 'create' | 'edit'
  initialProfile: ProjectProfile | null
  salvageNotice: 'partial' | 'full' | null
}

export function deriveIntakeEntry(raw: unknown): IntakeEntry {
  const { profile, dropped } = salvageProjectProfile(raw)
  const hasContent =
    profile !== null &&
    (Object.keys(profile.facts).length > 0 ||
      Object.keys(profile.goals).length > 0 ||
      profile.unknowns.length > 0 ||
      Object.keys(profile.assumptions).length > 0)
  const salvageNotice: 'partial' | 'full' | null =
    dropped.length === 0 ? null : profile === null ? 'full' : 'partial'
  return {
    mode: hasContent ? 'edit' : 'create',
    initialProfile: hasContent ? profile : null,
    salvageNotice,
  }
}

function salvageRecord<T>(
  raw: unknown,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  section: string,
  dropped: string[]
): Record<string, T> {
  const out: Record<string, T> = {}
  if (raw === undefined || raw === null) return out
  if (!isPlainObject(raw)) {
    dropped.push(section)
    return out
  }
  for (const [key, value] of Object.entries(raw)) {
    const parsed = schema.safeParse(value)
    if (parsed.success) {
      out[key] = parsed.data
    } else {
      dropped.push(`${section}.${key}`)
    }
  }
  return out
}

function salvageGoals(raw: unknown, dropped: string[]): Record<string, ProjectPrimitiveValue> {
  const out: Record<string, ProjectPrimitiveValue> = {}
  if (raw === undefined || raw === null) return out
  if (!isPlainObject(raw)) {
    dropped.push('goals')
    return out
  }
  for (const [key, value] of Object.entries(raw)) {
    const parsed = ProjectPrimitiveValueSchema.safeParse(value)
    if (parsed.success) {
      out[key] = parsed.data
    } else {
      dropped.push(`goals.${key}`)
    }
  }
  return out
}

function salvageUnknowns(raw: unknown, dropped: string[]): string[] {
  const out: string[] = []
  if (raw === undefined || raw === null) return out
  if (!Array.isArray(raw)) {
    dropped.push('unknowns')
    return out
  }
  raw.forEach((item, index) => {
    if (typeof item === 'string') {
      out.push(item)
    } else {
      dropped.push(`unknowns[${index}]`)
    }
  })
  return out
}

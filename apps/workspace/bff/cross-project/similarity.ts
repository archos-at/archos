import type { Project } from '@/lib/db/schema/projects'
import { normalizeProfileToken } from '@/lib/project-profile/legacy-names'

export interface SimilarityFacts {
  federal_state: string | null
  building_class: readonly number[]
  construction_method: readonly string[]
  uses: readonly string[]
  work_type: readonly string[]
}

type Profile = Pick<Project, 'profile'>['profile']

function valuesOf(value: unknown): unknown[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? (value as unknown[]) : [value]
}

function factValues(profile: Profile | null, key: string): unknown[] {
  const facts = profile?.facts ?? {}
  return Object.keys(facts)
    .filter((name) => {
      const [base, , zone] = name.split('@')
      return base === key && zone === undefined
    })
    .sort()
    .flatMap((name) => valuesOf(facts[name]?.value))
}

function readKey(profile: Profile | null, key: string): unknown[] {
  const confirmed = factValues(profile, key)
  if (confirmed.length > 0) return confirmed
  const suggestion = profile?.assumptions?.[key]
  return suggestion?.source === 'agent_suggested' ? valuesOf(suggestion.value) : []
}

function token(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return value
    .trim()
    .toLocaleLowerCase('de')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
}

const ABROAD = 'outside_austria'

export function federalStateOf(profile: Profile | null): string | null {
  return tokens(factValues(profile, 'federal_state'), 'federal_state')[0] ?? null
}

function comparedState(profile: Profile | null): string | null {
  const found = tokens(readKey(profile, 'federal_state'), 'federal_state')[0] ?? null
  return found === ABROAD ? null : found
}

const LOWEST_CLASS = 1
const HIGHEST_CLASS = 5

const CLASS_ALONE = /^(?:gk|geb(?:ä|ae)udeklasse)?\s*([1-5])$/i
const CLASS_NAMED = /\bgk\s*([1-5])\b/i

function buildingClassOf(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= LOWEST_CLASS && value <= HIGHEST_CLASS ? value : null
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  const match = CLASS_ALONE.exec(text) ?? CLASS_NAMED.exec(text)
  return match ? Number(match[1]) : null
}

export const UNDECIDED = 'open'

function tokens(values: readonly unknown[], key: string): string[] {
  const found = values
    .map(token)
    .filter((entry): entry is string => entry !== null)
    .map((entry) => normalizeProfileToken(key, entry))
    .filter((entry) => entry !== UNDECIDED)
  return [...new Set(found)]
}

function overlap(a: readonly string[], b: readonly string[]): string[] {
  return a.filter((entry) => b.includes(entry))
}

export function similarityFacts(profile: Profile | null): SimilarityFacts {
  return {
    federal_state: comparedState(profile),
    building_class: [
      ...new Set(
        readKey(profile, 'building_class')
          .map(buildingClassOf)
          .filter((value): value is number => value !== null)
      ),
    ].sort((a, b) => a - b),
    construction_method: tokens(readKey(profile, 'construction_method'), 'construction_method'),
    uses: tokens(readKey(profile, 'uses'), 'uses'),
    work_type: tokens(readKey(profile, 'work_type'), 'work_type'),
  }
}

export function confirmedSimilarityFacts(profile: Profile | null): SimilarityFacts {
  return similarityFacts(profile ? { ...profile, assumptions: {} } : null)
}

export const SIMILARITY_WEIGHTS = {
  federalState: 4,
  buildingClass: 3,
  buildingClassAdjacent: 1,
  constructionMethod: 2,
  use: 1,
  useMax: 2,
  workType: 1,
} as const

function closestClass(a: readonly number[], b: readonly number[]): number | null {
  const distances = a.flatMap((x) => b.map((y) => Math.abs(x - y)))
  return distances.length > 0 ? Math.min(...distances) : null
}

export function similarity(current: SimilarityFacts, candidate: SimilarityFacts): number {
  const w = SIMILARITY_WEIGHTS
  let score = 0
  if (current.federal_state && current.federal_state === candidate.federal_state) score += w.federalState
  const distance = closestClass(current.building_class, candidate.building_class)
  if (distance === 0) score += w.buildingClass
  else if (distance === 1) score += w.buildingClassAdjacent
  if (overlap(current.construction_method, candidate.construction_method).length > 0) score += w.constructionMethod
  const shared = overlap(current.uses, candidate.uses).length
  score += Math.min(shared * w.use, w.useMax)
  if (overlap(current.work_type, candidate.work_type).length > 0) score += w.workType
  return score
}

export interface SharedTrait {
  key: keyof SimilarityFacts
  value: string
}

export function sharedTraits(current: SimilarityFacts, candidate: SimilarityFacts): SharedTrait[] {
  const traits: SharedTrait[] = []
  if (current.federal_state && current.federal_state === candidate.federal_state) {
    traits.push({ key: 'federal_state', value: candidate.federal_state })
  }
  for (const value of current.building_class.filter((gk) => candidate.building_class.includes(gk))) {
    traits.push({ key: 'building_class', value: String(value) })
  }
  for (const value of overlap(current.construction_method, candidate.construction_method)) traits.push({ key: 'construction_method', value })
  for (const value of overlap(current.uses, candidate.uses)) traits.push({ key: 'uses', value })
  for (const value of overlap(current.work_type, candidate.work_type)) traits.push({ key: 'work_type', value })
  return traits
}

export function holdsTrait(trait: SharedTrait, facts: SimilarityFacts): boolean {
  if (trait.key === 'federal_state') return facts.federal_state === trait.value
  if (trait.key === 'building_class') return facts.building_class.includes(Number(trait.value))
  return facts[trait.key].includes(trait.value)
}

export function rankBySimilarity<P extends Pick<Project, 'profile'>>(current: Profile | null, projects: readonly P[]): P[] {
  if (!current) return [...projects]
  const facts = similarityFacts(current)
  return projects
    .map((project, index) => ({ project, index, score: similarity(facts, similarityFacts(project.profile)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.project)
}
